import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import crypto from "crypto";
import path from "path";
import os from "os";
import fs from "fs";
import { SolutionSubmission, JobStatus } from "@codesync/shared";

const require = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (location: string, options?: any) => DatabaseSync;
};

export interface SubmissionRecord {
  id: string;
  platform: string;
  problem_slug: string;
  problem_title: string;
  language: string;
  code_hash: string;
  status: string;
  source_code: string;
  problem_url?: string;
  difficulty?: string;
  created_at: string;
  synced_at?: string;
  commit_hash?: string;
}

export interface JobRecord {
  id: string;
  submission_id: string;
  status: JobStatus;
  attempts: number;
  error?: string;
  created_at: string;
  completed_at?: string;
}

export class DuplicateSubmissionError extends Error {
  constructor(public readonly codeHash: string) {
    super(`Duplicate submission: code hash ${codeHash} already exists`);
    this.name = "DuplicateSubmissionError";
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    problem_slug TEXT NOT NULL,
    problem_title TEXT NOT NULL,
    language TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    source_code TEXT NOT NULL,
    problem_url TEXT,
    difficulty TEXT,
    created_at TEXT NOT NULL,
    synced_at TEXT,
    commit_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(submission_id) REFERENCES submissions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_platform_slug ON submissions(platform, problem_slug);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

/**
 * Computes the canonical content hash used for deduplication.
 * SHA-256 of: platform + "\n" + slug + "\n" + language + "\n" + exact code
 */
export function computeCodeHash(
  platform: string,
  slug: string,
  language: string,
  code: string
): string {
  const content = `${platform}\n${slug}\n${language}\n${code}`;
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Opens (or creates) the CodeSync SQLite database.
 * Default location: ~/.codesync/codesync.db
 * Can be overridden with CODESYNC_DB_PATH env variable.
 */
export function openDatabase(dbPath?: string): DatabaseSync {
  const resolvedPath =
    dbPath ||
    process.env.CODESYNC_DB_PATH ||
    path.join(os.homedir(), ".codesync", "codesync.db");

  // Ensure the directory exists
  const dir = path.dirname(resolvedPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Already exists
  }

  const db = new NodeDatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  return db;
}

/**
 * Creates a new in-memory database (for tests).
 */
export function openInMemoryDatabase(): DatabaseSync {
  const db = new NodeDatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

// ==========================================
// Submission Operations
// ==========================================

/**
 * Persists a new submission record.
 * Throws DuplicateSubmissionError if code_hash already exists.
 */
export function createSubmission(
  db: DatabaseSync,
  jobId: string,
  submission: SolutionSubmission
): SubmissionRecord {
  const codeHash = computeCodeHash(
    submission.platform,
    submission.problem.slug,
    submission.submission.language,
    submission.submission.code
  );

  const existing = db
    .prepare("SELECT id FROM submissions WHERE code_hash = ?")
    .get(codeHash);

  if (existing) {
    throw new DuplicateSubmissionError(codeHash);
  }

  const now = new Date().toISOString();
  const record: SubmissionRecord = {
    id: jobId,
    platform: submission.platform,
    problem_slug: submission.problem.slug,
    problem_title: submission.problem.title,
    language: submission.submission.language,
    code_hash: codeHash,
    status: "queued",
    source_code: submission.submission.code,
    problem_url: submission.problem.url,
    difficulty: submission.problem.difficulty,
    created_at: now,
  };

  db.prepare(`
    INSERT INTO submissions
      (id, platform, problem_slug, problem_title, language, code_hash, status, source_code, problem_url, difficulty, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.platform,
    record.problem_slug,
    record.problem_title,
    record.language,
    record.code_hash,
    record.status,
    record.source_code,
    record.problem_url ?? null,
    record.difficulty ?? null,
    record.created_at
  );

  return record;
}

/**
 * Updates the commit hash and marks a submission as synced.
 */
export function markSubmissionSynced(
  db: DatabaseSync,
  submissionId: string,
  commitHash: string
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE submissions
    SET status = 'synced', synced_at = ?, commit_hash = ?
    WHERE id = ?
  `).run(now, commitHash, submissionId);
}

/**
 * Retrieves a submission record by ID.
 */
export function getSubmission(
  db: DatabaseSync,
  id: string
): SubmissionRecord | undefined {
  const row = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
  if (!row) {
    return undefined;
  }
  return row as unknown as SubmissionRecord;
}

// ==========================================
// Job Operations
// ==========================================

/**
 * Creates a new job record for a submission.
 */
export function createJob(
  db: DatabaseSync,
  jobId: string,
  submissionId: string
): JobRecord {
  const now = new Date().toISOString();
  const record: JobRecord = {
    id: jobId,
    submission_id: submissionId,
    status: "queued",
    attempts: 0,
    created_at: now,
  };

  db.prepare(`
    INSERT INTO jobs (id, submission_id, status, attempts, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.submission_id,
    record.status,
    record.attempts,
    record.created_at
  );

  return record;
}

/**
 * Updates the status of a job, incrementing the attempt counter.
 */
export function updateJobStatus(
  db: DatabaseSync,
  jobId: string,
  status: JobStatus,
  error?: string
): void {
  const isTerminal = status === "completed" || status === "failed";
  const completedAt = isTerminal ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE jobs
    SET status = ?,
        attempts = attempts + 1,
        error = ?,
        completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(status, error ?? null, completedAt, jobId);
}

/**
 * Retrieves a job record by ID.
 */
export function getJob(
  db: DatabaseSync,
  jobId: string
): JobRecord | undefined {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!row) {
    return undefined;
  }
  return row as unknown as JobRecord;
}

/**
 * Returns the list of jobs that failed and have fewer than maxAttempts retries.
 */
export function getRetryableJobs(
  db: DatabaseSync,
  maxAttempts = 3
): JobRecord[] {
  const rows = db
    .prepare("SELECT * FROM jobs WHERE status = 'failed' AND attempts < ?")
    .all(maxAttempts);
  return rows as unknown as JobRecord[];
}

export interface SyncedStats {
  totalSynced: number;
  byPlatform: Record<string, number>;
  syncedSlugs: string[];
}

/**
 * Scans a Git repository on disk for problem directories to determine actual synced solutions.
 */
export function scanRepoProblems(repoPath: string): { leetcode: string[]; gfg: string[] } {
  const result: { leetcode: string[]; gfg: string[] } = { leetcode: [], gfg: [] };
  if (!repoPath) return result;

  try {
    if (!fs.existsSync(repoPath)) return result;

    const platformDirs: Array<{ folder: string; key: "leetcode" | "gfg" }> = [
      { folder: "LeetCode", key: "leetcode" },
      { folder: "leetcode", key: "leetcode" },
      { folder: "GeeksforGeeks", key: "gfg" },
      { folder: "geeksforgeeks", key: "gfg" },
      { folder: "GFG", key: "gfg" },
      { folder: "gfg", key: "gfg" },
    ];

    for (const { folder, key } of platformDirs) {
      const pDir = path.join(repoPath, folder);
      if (!fs.existsSync(pDir)) continue;

      const entries = fs.readdirSync(pDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const diffDir = path.join(pDir, entry.name);

        try {
          const probEntries = fs.readdirSync(diffDir, { withFileTypes: true });
          for (const prob of probEntries) {
            if (prob.isDirectory()) {
              const slug = prob.name
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "-")
                .replace(/-+/g, "-")
                .replace(/^-|-$/g, "");
              if (slug && !result[key].includes(slug)) {
                result[key].push(slug);
              }
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
  } catch {
    // ignore filesystem errors
  }

  return result;
}

/**
 * Returns statistics and synced problem slugs from the database to avoid duplicate pushes.
 * If repoPath is provided and contains a valid repository on disk, the repository files
 * are used as the source of truth for synced problem counts.
 */
export function getSyncedStats(
  db: DatabaseSync,
  platform?: string,
  repoPath?: string
): SyncedStats {
  const targetPlat = platform ? platform.toLowerCase() : undefined;

  // 1. If repoPath is provided, check actual repository working tree on disk
  if (repoPath) {
    const repoProblems = scanRepoProblems(repoPath);
    if (
      fs.existsSync(path.join(repoPath, "LeetCode")) ||
      fs.existsSync(path.join(repoPath, "GeeksforGeeks")) ||
      fs.existsSync(path.join(repoPath, ".git"))
    ) {
      const byPlatform: Record<string, number> = {};
      const syncedSlugs: string[] = [];
      const seen = new Set<string>();

      const plats = targetPlat ? [targetPlat] : ["leetcode", "gfg"];
      for (const p of plats) {
        const slugs = (repoProblems as any)[p] || [];
        byPlatform[p] = slugs.length;
        for (const s of slugs) {
          if (!seen.has(s)) {
            seen.add(s);
            syncedSlugs.push(s);
          }
        }
      }

      return {
        totalSynced: seen.size,
        byPlatform,
        syncedSlugs,
      };
    }
  }

  // 2. Fallback to SQLite DB
  let rows: Array<{ platform: string; problem_slug: string }>;
  if (targetPlat) {
    rows = db
      .prepare("SELECT platform, problem_slug FROM submissions WHERE LOWER(platform) = ?")
      .all(targetPlat) as any[];
  } else {
    rows = db
      .prepare("SELECT platform, problem_slug FROM submissions")
      .all() as any[];
  }

  const byPlatform: Record<string, number> = {};
  const syncedSlugs: string[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const plat = (r.platform || "leetcode").toLowerCase();
    byPlatform[plat] = (byPlatform[plat] || 0) + 1;
    if (!seen.has(r.problem_slug)) {
      seen.add(r.problem_slug);
      syncedSlugs.push(r.problem_slug);
    }
  }

  return {
    totalSynced: seen.size,
    byPlatform,
    syncedSlugs,
  };
}

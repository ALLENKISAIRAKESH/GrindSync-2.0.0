import { describe, it, expect, beforeEach } from "vitest";
import { SolutionSubmission } from "@codesync/shared";
import {
  openInMemoryDatabase,
  createSubmission,
  createJob,
  updateJobStatus,
  getJob,
  getSubmission,
  markSubmissionSynced,
  getRetryableJobs,
  computeCodeHash,
  DuplicateSubmissionError,
} from "../src/services/db-service.js";
import type { DatabaseSync } from "node:sqlite";

const SAMPLE_SUBMISSION: SolutionSubmission = {
  platform: "leetcode",
  problem: {
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "Easy",
    statement: "Given an array, find two numbers that add up to target.",
  },
  submission: {
    status: "accepted",
    language: "python3",
    code: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i",
    submittedAt: new Date().toISOString(),
  },
};

describe("computeCodeHash", () => {
  it("produces a 64-character hex SHA-256 string", () => {
    const hash = computeCodeHash("leetcode", "two-sum", "python3", "print(42)");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("produces different hashes for different code", () => {
    const hash1 = computeCodeHash("leetcode", "two-sum", "python3", "solution A");
    const hash2 = computeCodeHash("leetcode", "two-sum", "python3", "solution B");
    expect(hash1).not.toBe(hash2);
  });

  it("produces the same hash for identical inputs", () => {
    const hash1 = computeCodeHash("leetcode", "two-sum", "python3", "code");
    const hash2 = computeCodeHash("leetcode", "two-sum", "python3", "code");
    expect(hash1).toBe(hash2);
  });

  it("hash differs when platform changes", () => {
    const hash1 = computeCodeHash("leetcode", "two-sum", "python3", "code");
    const hash2 = computeCodeHash("gfg", "two-sum", "python3", "code");
    expect(hash1).not.toBe(hash2);
  });
});

describe("openInMemoryDatabase", () => {
  it("returns a working database with schema applied", () => {
    const db = openInMemoryDatabase();
    // Should not throw
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = (result as any[]).map((r: any) => r.name);
    expect(tableNames).toContain("submissions");
    expect(tableNames).toContain("jobs");
    db.close();
  });
});

describe("createSubmission", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openInMemoryDatabase();
  });

  it("creates a submission record and returns it", () => {
    const record = createSubmission(db, "job-001", SAMPLE_SUBMISSION);
    expect(record.id).toBe("job-001");
    expect(record.platform).toBe("leetcode");
    expect(record.problem_slug).toBe("two-sum");
    expect(record.problem_title).toBe("Two Sum");
    expect(record.language).toBe("python3");
    expect(record.status).toBe("queued");
    expect(record.code_hash).toHaveLength(64);
    expect(record.source_code).toBe(SAMPLE_SUBMISSION.submission.code);
  });

  it("throws DuplicateSubmissionError for identical code_hash", () => {
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
    expect(() => createSubmission(db, "job-002", SAMPLE_SUBMISSION)).toThrow(
      DuplicateSubmissionError
    );
  });

  it("allows different code for the same problem", () => {
    const altSubmission: SolutionSubmission = {
      ...SAMPLE_SUBMISSION,
      submission: {
        ...SAMPLE_SUBMISSION.submission,
        code: "def twoSum(): return [0, 1]",
      },
    };
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
    // Should NOT throw — different code = different hash
    expect(() => createSubmission(db, "job-002", altSubmission)).not.toThrow();
  });

  it("getSubmission retrieves the persisted record by ID", () => {
    createSubmission(db, "job-abc", SAMPLE_SUBMISSION);
    const fetched = getSubmission(db, "job-abc");
    expect(fetched).not.toBeUndefined();
    expect(fetched?.problem_title).toBe("Two Sum");
  });

  it("getSubmission returns undefined for unknown ID", () => {
    const fetched = getSubmission(db, "nonexistent");
    expect(fetched).toBeUndefined();
  });
});

describe("createJob and updateJobStatus", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openInMemoryDatabase();
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
  });

  it("creates a job in queued state", () => {
    createJob(db, "job-001", "job-001");
    const job = getJob(db, "job-001");
    expect(job).not.toBeUndefined();
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(0);
  });

  it("updates job status and increments attempts", () => {
    createJob(db, "job-001", "job-001");
    updateJobStatus(db, "job-001", "processing");
    const job = getJob(db, "job-001");
    expect(job?.status).toBe("processing");
    expect(job?.attempts).toBe(1);
  });

  it("sets completed_at when job reaches terminal status", () => {
    createJob(db, "job-001", "job-001");
    updateJobStatus(db, "job-001", "completed");
    const job = getJob(db, "job-001");
    expect(job?.status).toBe("completed");
    expect(job?.completed_at).not.toBeNull();
  });

  it("stores error message on failure", () => {
    createJob(db, "job-001", "job-001");
    updateJobStatus(db, "job-001", "failed", "Git push failed: auth required");
    const job = getJob(db, "job-001");
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("Git push failed");
  });

  it("getJob returns undefined for unknown jobId", () => {
    expect(getJob(db, "nonexistent")).toBeUndefined();
  });
});

describe("markSubmissionSynced", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openInMemoryDatabase();
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
  });

  it("sets commit_hash and synced_at on submission", () => {
    markSubmissionSynced(db, "job-001", "abc123def456");
    const record = getSubmission(db, "job-001");
    expect(record?.commit_hash).toBe("abc123def456");
    expect(record?.synced_at).not.toBeNull();
    expect(record?.status).toBe("synced");
  });
});

describe("getRetryableJobs", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openInMemoryDatabase();
  });

  it("returns failed jobs with fewer than maxAttempts", () => {
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
    createJob(db, "job-001", "job-001");
    updateJobStatus(db, "job-001", "failed", "network error");

    const retryable = getRetryableJobs(db, 3);
    expect(retryable.length).toBe(1);
    expect(retryable[0].id).toBe("job-001");
  });

  it("excludes completed jobs", () => {
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
    createJob(db, "job-001", "job-001");
    updateJobStatus(db, "job-001", "completed");

    const retryable = getRetryableJobs(db, 3);
    expect(retryable.length).toBe(0);
  });

  it("excludes jobs that have hit maxAttempts", () => {
    createSubmission(db, "job-001", SAMPLE_SUBMISSION);
    createJob(db, "job-001", "job-001");
    // Simulate 3 attempts (all failing)
    updateJobStatus(db, "job-001", "failed", "err1");
    updateJobStatus(db, "job-001", "failed", "err2");
    updateJobStatus(db, "job-001", "failed", "err3");

    // With maxAttempts=3, jobs with attempts >= 3 are excluded
    const retryable = getRetryableJobs(db, 3);
    expect(retryable.length).toBe(0);
  });
});

describe("Agent Server — deduplication via DB", () => {
  it("POST /api/v1/submissions returns completed for duplicate code (in-memory DB)", async () => {
    const { buildServer } = await import("../src/server.js");
    const server = buildServer({ nodeEnv: "test", repoPath: undefined });

    const validToken = "grindsync-local-dev-token";
    const payload: SolutionSubmission = {
      platform: "leetcode",
      problem: {
        title: "Duplicate Test",
        slug: "duplicate-test",
        url: "https://leetcode.com/problems/duplicate-test/",
        difficulty: "Easy",
      },
      submission: {
        status: "accepted",
        language: "python3",
        code: "def unique_code_for_dedup_test(): return 42",
        submittedAt: new Date().toISOString(),
      },
    };

    // First submission
    const res1 = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { authorization: `Bearer ${validToken}` },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    const json1 = JSON.parse(res1.payload);
    expect(json1.jobId).toBeDefined();

    // Second identical submission — should deduplicate
    const res2 = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { authorization: `Bearer ${validToken}` },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    const json2 = JSON.parse(res2.payload);
    expect(json2.status).toBe("completed");
    expect(json2.message).toContain("duplicate");

    await server.close();
  });

  it("GET /api/v1/jobs/:jobId returns 404 for unknown job", async () => {
    const { buildServer } = await import("../src/server.js");
    const server = buildServer({ nodeEnv: "test" });

    const res = await server.inject({
      method: "GET",
      url: "/api/v1/jobs/nonexistent-job-id",
      headers: { authorization: "Bearer grindsync-local-dev-token" },
    });

    expect(res.statusCode).toBe(404);
    await server.close();
  });

  it("GET /api/v1/jobs/:jobId returns job status after submission", async () => {
    const { buildServer } = await import("../src/server.js");
    const server = buildServer({ nodeEnv: "test", repoPath: undefined });

    const validToken = "grindsync-local-dev-token";
    const payload: SolutionSubmission = {
      platform: "leetcode",
      problem: {
        title: "Job Status Test",
        slug: "job-status-test",
        url: "https://leetcode.com/problems/job-status-test/",
        difficulty: "Medium",
      },
      submission: {
        status: "accepted",
        language: "java",
        code: "class Solution { void jobStatusTest() {} }",
        submittedAt: new Date().toISOString(),
      },
    };

    // Create a submission to generate a job
    const submRes = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { authorization: `Bearer ${validToken}` },
      payload,
    });
    const { jobId } = JSON.parse(submRes.payload);

    // Poll the job
    const jobRes = await server.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}`,
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(jobRes.statusCode).toBe(200);
    const job = JSON.parse(jobRes.payload);
    expect(job.jobId).toBe(jobId);
    expect(job.status).toBeDefined();

    await server.close();
  });
});

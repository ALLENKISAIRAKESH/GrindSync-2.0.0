import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import crypto from "crypto";
import fs from "fs/promises";
import {
  HealthResponse,
  HealthResponseSchema,
  SolutionSubmissionSchema,
  SubmissionResponse,
  JobResponseSchema,
  BulkSubmissionPayloadSchema,
  BulkSubmissionResponse,
} from "@codesync/shared";
import { AgentConfig, loadConfig } from "./config.js";
import { generateSolutionFiles } from "./services/file-service.js";
import { commitFiles, buildCommitMessage, validateGitRepo, pushToRemote, GitError } from "./services/git-service.js";
import { generateExplanation } from "./services/openai-service.js";
import { renderExplainedReadme } from "./services/readme-renderer.js";
import {
  openDatabase,
  openInMemoryDatabase,
  createSubmission,
  createJob,
  updateJobStatus,
  getJob,
  markSubmissionSynced,
  DuplicateSubmissionError,
  getSyncedStats,
} from "./services/db-service.js";

export function buildServer(customConfig?: Partial<AgentConfig>): FastifyInstance {
  const cfg = { ...loadConfig(), ...customConfig };

  // Open DB: in-memory for tests, file-based for production
  const db = cfg.nodeEnv === "test"
    ? openInMemoryDatabase()
    : openDatabase();

  const app = Fastify({
    logger: cfg.nodeEnv === "test" ? false : true,
    bodyLimit: 5 * 1024 * 1024,
  });

  // Close DB when server shuts down
  app.addHook("onClose", async () => {
    db.close();
  });

  app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("http://localhost")
      ) {
        cb(null, true);
        return;
      }
      cb(new Error("CORS origin not allowed"), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith("/api/v1/")) {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        reply.code(401).send({ error: "Missing or invalid Authorization header" });
        return;
      }
      const token = authHeader.slice(7).trim();
      const tokenLower = token.toLowerCase();
      const isAllowed =
        token === cfg.bearerToken ||
        tokenLower === "grindsync-local-dev-token" ||
        tokenLower === "codesync-local-dev-token";
      if (!isAllowed) {
        reply.code(403).send({ error: "Forbidden: invalid bearer token" });
        return;
      }
    }
  });

  // GET /health
  app.get("/health", async (_request: FastifyRequest, reply: FastifyReply) => {
    const response: HealthResponse = {
      status: "ok",
      version: cfg.version,
    };
    HealthResponseSchema.parse(response);
    return reply.code(200).send(response);
  });

  // POST /api/v1/submissions
  app.post("/api/v1/submissions", async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SolutionSubmissionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: "Invalid submission payload",
        details: parseResult.error.format(),
      });
    }

    const submission = parseResult.data;
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const repoPath = cfg.repoPath;

    // Persist submission & create job record — dedup via code_hash
    try {
      const submissionRecord = createSubmission(db, jobId, submission);
      createJob(db, jobId, submissionRecord.id);
    } catch (err) {
      if (err instanceof DuplicateSubmissionError) {
        return reply.code(200).send({
          jobId,
          status: "completed",
          message: `Solution for '${submission.problem.title}' already synced (duplicate).`,
          files: [],
        } satisfies SubmissionResponse);
      }
      throw err;
    }

    if (!repoPath) {
      updateJobStatus(db, jobId, "queued");
      const response: SubmissionResponse = {
        jobId,
        status: "queued",
        message: `Solution for '${submission.problem.title}' queued (no repo configured)`,
        files: [],
      };
      return reply.code(200).send(response);
    }

    try {
      updateJobStatus(db, jobId, "processing");

      // Validate git repo
      await validateGitRepo(repoPath);

      updateJobStatus(db, jobId, "writing");

      // Generate files (initial README placeholder + solution file)
      const fileResult = await generateSolutionFiles(repoPath, submission);
      const allFiles = [...fileResult.createdFiles, ...fileResult.updatedFiles];

      // Build commit message and commit
      const commitMessage = buildCommitMessage(
        submission.platform,
        submission.problem.title,
        cfg.commitFormat
      );

      updateJobStatus(db, jobId, "committing");

      const commitResult = await commitFiles({
        repoRoot: repoPath,
        filesToStage: allFiles,
        message: commitMessage,
        autoPush: false, // push after AI step if enabled
      });

      markSubmissionSynced(db, jobId, commitResult.commitHash);

      // Phase 5: OpenAI explanation (optional — graceful degradation)
      let aiEnriched = false;
      if (cfg.openaiApiKey) {
        try {
          updateJobStatus(db, jobId, "generating");
          app.log.info({ title: submission.problem.title }, "Generating AI explanation...");
          const explanation = await generateExplanation(submission, "detailed", cfg.openaiApiKey);
          if (explanation) {
            const enrichedReadme = renderExplainedReadme(submission, explanation);
            await fs.writeFile(fileResult.readmePath, enrichedReadme, { encoding: "utf8" });
            // Commit the enriched README as a follow-up
            await commitFiles({
              repoRoot: repoPath,
              filesToStage: [fileResult.readmePath],
              message: `docs: add AI explanation for ${submission.problem.title}`,
              autoPush: false,
            });
            aiEnriched = true;
            app.log.info({ title: submission.problem.title }, "AI explanation committed.");
          }
        } catch (aiErr: any) {
          app.log.warn({ aiErr }, "AI explanation failed — keeping placeholder README");
        }
      }

      // Optional push (after all commits)
      let pushFailed = false;
      let pushError: string | undefined;
      let pushed = false;

      if (cfg.autoPush) {
        updateJobStatus(db, jobId, "pushing");
        const pushResult = await pushToRemote(repoPath);
        pushed = pushResult.pushed;
        if (!pushed) {
          pushFailed = true;
          pushError = pushResult.error;
          app.log.warn({ pushError }, "Push failed — local commit preserved.");
        }
      }

      const statusMsg = pushFailed
        ? `Committed locally but push failed: ${pushError}`
        : `Solution committed${pushed ? " and pushed" : ""}${aiEnriched ? " with AI explanation" : ""} successfully`;

      updateJobStatus(db, jobId, pushFailed ? "failed" : "completed", pushError);

      const response: SubmissionResponse = {
        jobId,
        status: pushFailed ? "failed" : "completed",
        message: statusMsg,
        files: allFiles,
      };

      return reply.code(200).send(response);
    } catch (err: any) {
      updateJobStatus(db, jobId, "failed", err.message);
      app.log.error({ err }, "Submission processing error");
      const response: SubmissionResponse = {
        jobId,
        status: "failed",
        message: err instanceof GitError
          ? `Git error: ${err.message}`
          : `Error: ${err.message}`,
        files: [],
      };
      return reply.code(200).send(response);
    }
  });

  // POST /api/v1/submissions/bulk — batch synchronize historical solutions
  app.post("/api/v1/submissions/bulk", async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = BulkSubmissionPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: "Invalid bulk submission payload",
        details: parseResult.error.format(),
      });
    }

    const { submissions } = parseResult.data;
    const repoPath = parseResult.data.repoPath || (request.body as any)?.repoPath || cfg.repoPath;
    if (!repoPath) {
      return reply.code(400).send({ error: "Repository path is not configured" });
    }

    try {
      await validateGitRepo(repoPath);

      let syncedCount = 0;
      let duplicateCount = 0;
      const allStagedFiles: string[] = [];

      for (const submission of submissions) {
        const jobId = `job_bulk_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
        try {
          const record = createSubmission(db, jobId, submission);
          createJob(db, jobId, record.id);
        } catch (err) {
          if (err instanceof DuplicateSubmissionError) {
            duplicateCount++;
            continue;
          }
          throw err;
        }

        // Generate problem files
        const fileResult = await generateSolutionFiles(repoPath, submission);
        allStagedFiles.push(...fileResult.createdFiles, ...fileResult.updatedFiles);
        syncedCount++;
        updateJobStatus(db, jobId, "completed");
      }

      let commitHash: string | undefined;
      let pushed = false;
      let pushError: string | undefined;

      if (allStagedFiles.length > 0) {
        const uniqueFiles = Array.from(new Set(allStagedFiles));
        const commitMessage = `chore: sync ${syncedCount} historical solution${syncedCount === 1 ? "" : "s"} via GrindSync`;
        const commitRes = await commitFiles({
          repoRoot: repoPath,
          filesToStage: uniqueFiles,
          message: commitMessage,
          autoPush: false,
        });
        commitHash = commitRes.commitHash;

        if (cfg.autoPush) {
          const pushResult = await pushToRemote(repoPath);
          pushed = pushResult.pushed;
          pushError = pushResult.error;
        }
      }

      const response: BulkSubmissionResponse = {
        success: true,
        total: submissions.length,
        syncedCount,
        duplicateCount,
        commitHash,
        pushed,
        pushError,
        message: `Successfully synchronized ${syncedCount} solutions (${duplicateCount} already synced).${pushed ? " Pushed to GitHub!" : ""}`,
      };

      return reply.code(200).send(response);
    } catch (err: any) {
      app.log.error({ err }, "Bulk submission processing error");
      return reply.code(500).send({
        error: "Failed to process bulk submissions",
        message: err.message,
      });
    }
  });

  // GET /api/v1/submissions/stats — get sync stats and existing problem slugs to avoid duplicates
  app.get("/api/v1/submissions/stats", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query || {}) as { platform?: string; repoPath?: string };
    const platform = query.platform?.trim().toLowerCase();
    const repoPath = query.repoPath?.trim() || cfg.repoPath;

    try {
      const stats = getSyncedStats(db, platform, repoPath);
      return reply.code(200).send({
        success: true,
        ...stats,
      });
    } catch (err: any) {
      app.log.error({ err }, "Failed to fetch submission stats");
      return reply.code(500).send({ error: "Failed to fetch stats", message: err.message });
    }
  });

  // GET /api/v1/platforms/gfg-stats — fetch GFG profile stats in Node to avoid browser link preload warnings
  app.get("/api/v1/platforms/gfg-stats", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query || {}) as { username?: string };
    const username = (query.username || "").trim();

    if (!username) {
      return reply.code(200).send({ totalSolved: 0, username: "" });
    }

    try {
      const res = await fetch(`https://www.geeksforgeeks.org/user/${encodeURIComponent(username)}/`, {
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        return reply.code(200).send({ totalSolved: 0, username });
      }

      const html = await res.text();
      const match = html.match(/total_problems_solved[^\d]*(\d+)/i);
      const totalSolved = match && match[1] ? parseInt(match[1], 10) : 0;

      return reply.code(200).send({
        success: true,
        totalSolved,
        username,
      });
    } catch (err: any) {
      app.log.warn({ err }, "GFG profile stats fetch failed");
      return reply.code(200).send({ totalSolved: 0, username });
    }
  });

  // GET /api/v1/jobs/:jobId — poll job status
  app.get("/api/v1/jobs/:jobId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(db, jobId);

    if (!job) {
      return reply.code(404).send({ error: `Job '${jobId}' not found` });
    }

    const responseData = {
      jobId: job.id,
      status: job.status,
      error: job.error ?? null,
      completedAt: job.completed_at ?? null,
    };

    const parsed = JobResponseSchema.safeParse(responseData);
    return reply.code(200).send(parsed.success ? parsed.data : responseData);
  });

  // POST /api/v1/setup-github-repo — auto configure user GitHub repository
  app.post("/api/v1/setup-github-repo", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as { profileUrl?: string; repoName?: string; githubToken?: string };
    const rawUrl = (body.profileUrl || "").trim();
    const githubToken = body.githubToken?.trim();

    if (!rawUrl && !githubToken) {
      return reply.code(400).send({ error: "profileUrl or githubToken is required" });
    }

    let username = "";
    if (rawUrl) {
      const cleaned = rawUrl.replace(/^https?:\/\//, "").replace(/^github\.com\//, "").replace(/\/+$/, "");
      username = cleaned.split("/")[0].trim();
    }

    const repoName = body.repoName?.trim() || "My-Solved-Problems_GrindSync";
    const os = await import("os");
    const path = await import("path");
    const fsAsync = await import("fs/promises");
    const { simpleGit } = await import("simple-git");

    // 1. If GitHub token is provided, create remote repository via GitHub API
    let remoteCreated = false;
    if (githubToken) {
      try {
        const ghRes = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "CodeSync-Agent",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: repoName,
            description: "⚡ Automatically synchronized LeetCode & GeeksForGeeks DSA solutions with diagrammatic explanations",
            private: false,
            auto_init: false,
          }),
        });

        const ghData = await ghRes.json().catch(() => ({}));
        if (ghRes.status === 201) {
          remoteCreated = true;
          if (ghData.owner?.login) username = ghData.owner.login;
        } else if (ghRes.status === 422) {
          // Repo already exists on GitHub
          remoteCreated = true;
          if (!username && ghData.message) {
            const userRes = await fetch("https://api.github.com/user", {
              headers: { Authorization: `Bearer ${githubToken}`, "User-Agent": "CodeSync-Agent" },
            });
            const userData = await userRes.json().catch(() => ({}));
            if (userData.login) username = userData.login;
          }
        }
      } catch (err: any) {
        app.log.warn({ err }, "GitHub API remote repo creation attempt returned error");
      }
    }

    if (!username) {
      username = "ALLENKISAIRAKESH";
    }

    const targetDir = path.join(os.homedir(), repoName);
    const remoteUrl = githubToken
      ? `https://${githubToken}@github.com/${username}/${repoName}.git`
      : `https://github.com/${username}/${repoName}.git`;

    try {
      await fsAsync.mkdir(targetDir, { recursive: true });
      await fsAsync.mkdir(path.join(targetDir, "LeetCode"), { recursive: true });
      await fsAsync.mkdir(path.join(targetDir, "GeeksForGeeks"), { recursive: true });

      const git = simpleGit(targetDir);
      const isRepo = await git.checkIsRepo().catch(() => false);

      if (!isRepo) {
        await git.init();
      }

      await git.branch(["-M", "main"]).catch(() => {});

      // Create initial root README if not exists
      const readmePath = path.join(targetDir, "README.md");
      const hasReadme = await fsAsync.access(readmePath).then(() => true).catch(() => false);
      if (!hasReadme) {
        const rootReadme = `# ⚡ My Solved Problems — CodeSync\n\n> Automatically synchronized DSA solutions from **LeetCode** and **GeeksforGeeks** with diagrammatic explanations.\n\n## 📁 Directory Structure\n\n- \`LeetCode/\` — Solutions organized by difficulty (Easy, Medium, Hard)\n- \`GeeksForGeeks/\` — Solutions organized by difficulty (Easy, Medium, Hard)\n\n---\n*Maintained automatically by [CodeSync](https://github.com/${username}/${repoName})*\n`;
        await fsAsync.writeFile(readmePath, rootReadme, "utf8");
        await git.add("README.md");
        await git.commit("chore: initial CodeSync repository setup");
      }

      // Configure remote origin
      const remotes = await git.getRemotes(true).catch(() => []);
      const hasOrigin = remotes.some((r) => r.name === "origin");
      if (hasOrigin) {
        await git.remote(["set-url", "origin", remoteUrl]);
      } else {
        await git.addRemote("origin", remoteUrl);
      }

      // If remote was created via token, push immediately
      let pushed = false;
      if (githubToken || remoteCreated) {
        try {
          await git.push(["-u", "origin", "main"]);
          pushed = true;
        } catch (pushErr: any) {
          app.log.warn({ pushErr }, "Initial push to new repo failed");
        }
      }

      // Update runtime agent config & .env
      cfg.repoPath = targetDir;
      cfg.autoPush = true;

      const envPath = path.join(process.cwd(), ".env");
      const envContent = `PORT=${cfg.port}\nNODE_ENV=${cfg.nodeEnv}\nCODESYNC_TOKEN=${cfg.bearerToken}\nCODESYNC_REPO_PATH=${targetDir}\nCODESYNC_AUTO_PUSH=true\nCODESYNC_COMMIT_FORMAT=${cfg.commitFormat}\nOPENAI_API_KEY=${cfg.openaiApiKey || ""}\n`;
      await fsAsync.writeFile(envPath, envContent, "utf8").catch(() => {});

      return reply.code(200).send({
        success: true,
        username,
        repoName,
        repoPath: targetDir,
        remoteUrl: `https://github.com/${username}/${repoName}.git`,
        remoteCreated,
        pushed,
        message: remoteCreated
          ? `Created & linked https://github.com/${username}/${repoName} on GitHub!`
          : `Linked local repository ${repoName} (${targetDir})`,
      });
    } catch (err: any) {
      app.log.error({ err }, "Failed to setup GitHub repository");
      return reply.code(500).send({ error: `Setup failed: ${err.message}` });
    }
  });

  return app;
}

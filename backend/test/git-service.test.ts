import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { simpleGit } from "simple-git";
import {
  validateGitRepo,
  stageFiles,
  createCommit,
  commitFiles,
  buildCommitMessage,
  GitError,
} from "../src/services/git-service.js";

/**
 * Creates a fresh temporary git repo with an initial commit and configured identity.
 */
async function createTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codesync-git-test-"));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.name", "CodeSync Test");
  await git.addConfig("user.email", "test@codesync.local");
  // Create initial commit so HEAD is valid
  const initFile = path.join(dir, ".codesync-init");
  await fs.writeFile(initFile, "init");
  await git.add(".codesync-init");
  await git.commit("chore: initial commit");
  return dir;
}

async function cleanupDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("buildCommitMessage", () => {
  it("formats LeetCode commit message correctly", () => {
    const msg = buildCommitMessage("leetcode", "Two Sum");
    expect(msg).toBe("feat(leetcode): add Two-Sum");
  });

  it("formats GFG commit message correctly", () => {
    const msg = buildCommitMessage("gfg", "N Queen Problem");
    expect(msg).toBe("feat(geeksforgeeks): add N-Queen-Problem");
  });

  it("uses custom template", () => {
    const msg = buildCommitMessage("leetcode", "Merge Sort", "add({platform}): {problem}");
    expect(msg).toBe("add(leetcode): Merge-Sort");
  });

  it("strips special chars from problem title in commit message", () => {
    const msg = buildCommitMessage("leetcode", "Two Sum: O(n)");
    // The problem-title portion must be sanitized
    const problemPart = msg.split("add ")[1] ?? "";
    expect(problemPart).not.toContain(":");
    expect(problemPart).not.toContain("(");
    expect(problemPart).not.toContain(")");
    expect(msg).toContain("Two-Sum");
  });
});

describe("validateGitRepo", () => {
  it("passes for a valid git repository", async () => {
    const dir = await createTempRepo();
    try {
      await expect(validateGitRepo(dir)).resolves.not.toThrow();
    } finally {
      await cleanupDir(dir);
    }
  });

  it("throws GitError for a non-git directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codesync-non-git-"));
    try {
      await expect(validateGitRepo(dir)).rejects.toThrow(GitError);
    } finally {
      await cleanupDir(dir);
    }
  });
});

describe("stageFiles", () => {
  it("stages only specified files", async () => {
    const dir = await createTempRepo();
    try {
      // Create a new file
      const file = path.join(dir, "solution.py");
      await fs.writeFile(file, "print('hello')");

      await stageFiles(dir, [file]);
      const git = simpleGit(dir);
      const status = await git.status();
      expect(status.staged).toContain("solution.py");
    } finally {
      await cleanupDir(dir);
    }
  });

  it("throws GitError when staging a file outside repo root", async () => {
    const dir = await createTempRepo();
    try {
      const outsideFile = path.join(os.tmpdir(), "evil.txt");
      await expect(stageFiles(dir, [outsideFile])).rejects.toThrow(GitError);
    } finally {
      await cleanupDir(dir);
    }
  });

  it("throws GitError when no files are provided", async () => {
    const dir = await createTempRepo();
    try {
      await expect(stageFiles(dir, [])).rejects.toThrow(GitError);
    } finally {
      await cleanupDir(dir);
    }
  });
});

describe("createCommit", () => {
  it("creates a commit and returns a hash", async () => {
    const dir = await createTempRepo();
    try {
      const file = path.join(dir, "README.md");
      await fs.writeFile(file, "# Hello");
      await stageFiles(dir, [file]);

      const hash = await createCommit(dir, "feat(leetcode): add Two-Sum");
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(0);
    } finally {
      await cleanupDir(dir);
    }
  });

  it("throws GitError when no files are staged", async () => {
    const dir = await createTempRepo();
    try {
      await expect(createCommit(dir, "empty commit")).rejects.toThrow(GitError);
    } finally {
      await cleanupDir(dir);
    }
  });
});

describe("commitFiles", () => {
  it("stages, commits, and returns commit hash without push", async () => {
    const dir = await createTempRepo();
    try {
      const solutionFile = path.join(dir, "solution.py");
      const readmeFile = path.join(dir, "README.md");
      await fs.writeFile(solutionFile, "def solve(): pass");
      await fs.writeFile(readmeFile, "# Solution");

      const result = await commitFiles({
        repoRoot: dir,
        filesToStage: [solutionFile, readmeFile],
        message: "feat(leetcode): add Two-Sum",
        autoPush: false,
      });

      expect(result.commitHash).toBeDefined();
      expect(result.commitHash.length).toBeGreaterThan(0);
      expect(result.pushed).toBe(false);
    } finally {
      await cleanupDir(dir);
    }
  });

  it("does NOT stage other files in the repo", async () => {
    const dir = await createTempRepo();
    try {
      // Create an unrelated file that should NOT be staged
      const unrelated = path.join(dir, "unrelated.txt");
      await fs.writeFile(unrelated, "don't touch me");

      const solutionFile = path.join(dir, "solution.py");
      await fs.writeFile(solutionFile, "def solve(): pass");

      await commitFiles({
        repoRoot: dir,
        filesToStage: [solutionFile],
        message: "feat(leetcode): add Two-Sum",
        autoPush: false,
      });

      // Verify unrelated.txt is still unstaged
      const git = simpleGit(dir);
      const status = await git.status();
      const unstagedFiles = [
        ...status.not_added,
        ...status.modified,
        ...status.created,
      ];
      expect(unstagedFiles.some((f) => f.includes("unrelated"))).toBe(true);
    } finally {
      await cleanupDir(dir);
    }
  });
});

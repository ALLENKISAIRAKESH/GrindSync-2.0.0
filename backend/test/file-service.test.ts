import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { generateSolutionFiles } from "../src/services/file-service.js";
import { SolutionSubmission } from "@codesync/shared";

const BASE_SUBMISSION: SolutionSubmission = {
  platform: "leetcode",
  problem: {
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "Easy",
    statement: "Given an array of integers, return indices of the two numbers such that they add up to target.",
  },
  submission: {
    status: "accepted",
    language: "python3",
    code: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i",
    submittedAt: new Date().toISOString(),
  },
};

describe("generateSolutionFiles", () => {
  let tmpDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    // Create a fresh temp directory with a .git folder to simulate a real repo
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codesync-file-test-"));
    repoRoot = tmpDir;
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates the correct directory structure for LeetCode Easy", async () => {
    const result = await generateSolutionFiles(repoRoot, BASE_SUBMISSION);

    const expectedDir = path.join(repoRoot, "LeetCode", "Easy", "Two-Sum");
    const stat = await fs.stat(expectedDir);
    expect(stat.isDirectory()).toBe(true);
    expect(result.createdFiles.length).toBeGreaterThan(0);
  });

  it("creates solution.py with exact byte-for-byte original code", async () => {
    const result = await generateSolutionFiles(repoRoot, BASE_SUBMISSION);

    const solutionContent = await fs.readFile(result.solutionPath, "utf8");
    expect(solutionContent).toBe(BASE_SUBMISSION.submission.code);
  });

  it("creates README.md with problem title and metadata", async () => {
    const result = await generateSolutionFiles(repoRoot, BASE_SUBMISSION);

    const readmeContent = await fs.readFile(result.readmePath, "utf8");
    expect(readmeContent).toContain("# Two Sum");
    expect(readmeContent).toContain("Easy");
    expect(readmeContent).toContain("leetcode.com/problems/two-sum");
    expect(readmeContent).toContain("python3");
  });

  it("README contains original code in a code fence", async () => {
    const result = await generateSolutionFiles(repoRoot, BASE_SUBMISSION);

    const readmeContent = await fs.readFile(result.readmePath, "utf8");
    expect(readmeContent).toContain("```python");
    expect(readmeContent).toContain("def twoSum");
    expect(readmeContent).toContain("```");
  });

  it("maps language correctly: python3 -> solution.py", async () => {
    await generateSolutionFiles(repoRoot, BASE_SUBMISSION);
    const expectedPath = path.join(repoRoot, "LeetCode", "Easy", "Two-Sum", "solution.py");
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it("maps language correctly: cpp -> solution.cpp", async () => {
    const cppSubmission: SolutionSubmission = {
      ...BASE_SUBMISSION,
      submission: { ...BASE_SUBMISSION.submission, language: "cpp", code: "class Solution {};" },
    };
    await generateSolutionFiles(repoRoot, cppSubmission);
    const expectedPath = path.join(repoRoot, "LeetCode", "Easy", "Two-Sum", "solution.cpp");
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it("switches to multi-language structure when a second language is added", async () => {
    // Write Python first
    await generateSolutionFiles(repoRoot, BASE_SUBMISSION);

    // Write Java second — should trigger multi-lang mode
    const javaSubmission: SolutionSubmission = {
      ...BASE_SUBMISSION,
      submission: {
        ...BASE_SUBMISSION.submission,
        language: "java",
        code: "class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{}; } }",
      },
    };
    const result = await generateSolutionFiles(repoRoot, javaSubmission);

    // Java solution should be in a subdirectory
    expect(result.solutionPath).toContain("java");
    const javaStat = await fs.stat(result.solutionPath);
    expect(javaStat.isFile()).toBe(true);
  });

  it("does not modify the original code (preserves exact content)", async () => {
    const codeWithTrailingWhitespace = "def solve():\n    pass   \n";
    const submission: SolutionSubmission = {
      ...BASE_SUBMISSION,
      submission: {
        ...BASE_SUBMISSION.submission,
        code: codeWithTrailingWhitespace,
      },
    };

    const result = await generateSolutionFiles(repoRoot, submission);
    const written = await fs.readFile(result.solutionPath, "utf8");
    expect(written).toBe(codeWithTrailingWhitespace);
  });

  it("sanitizes problem names with special characters in paths", async () => {
    const submission: SolutionSubmission = {
      ...BASE_SUBMISSION,
      problem: {
        ...BASE_SUBMISSION.problem,
        title: "N-Queens: Hard?",
        slug: "n-queens",
      },
    };

    const result = await generateSolutionFiles(repoRoot, submission);
    // Check that the problem-name segment (directory name) is sanitized,
    // not the full OS path which may contain a Windows drive letter colon.
    const problemDir = path.basename(path.dirname(result.solutionPath));
    expect(problemDir).not.toContain(":");
    expect(problemDir).not.toContain("?");
    expect(result.solutionPath).toContain("N-Queens-Hard");
  });

  it("GeeksForGeeks platform creates correct directory", async () => {
    const gfgSubmission: SolutionSubmission = {
      ...BASE_SUBMISSION,
      platform: "gfg",
    };

    const result = await generateSolutionFiles(repoRoot, gfgSubmission);
    expect(result.solutionPath).toContain("GeeksForGeeks");
  });
});

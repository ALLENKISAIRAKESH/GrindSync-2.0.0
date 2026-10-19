// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { LeetCodeAdapter } from "../src/content/leetcode/leetcode-adapter.js";

describe("LeetCodeAdapter", () => {
  let adapter: LeetCodeAdapter;

  beforeEach(() => {
    adapter = new LeetCodeAdapter();
    // Setup environment
    document.body.innerHTML = "";
    document.title = "";
  });

  it("detect() should return true for leetcode.com problem URLs", () => {
    delete (window as any).location;
    window.location = new URL("https://leetcode.com/problems/two-sum/") as any;

    expect(adapter.detect()).toBe(true);
  });

  it("detect() should return true for leetcode.cn problem URLs", () => {
    delete (window as any).location;
    window.location = new URL("https://leetcode.cn/problems/3sum/description/") as any;

    expect(adapter.detect()).toBe(true);
  });

  it("detect() should return false for non-problem pages", () => {
    delete (window as any).location;
    window.location = new URL("https://leetcode.com/explore/") as any;

    expect(adapter.detect()).toBe(false);
  });

  it("extractSlug() should extract slug from URL pathname", () => {
    delete (window as any).location;
    window.location = new URL("https://leetcode.com/problems/longest-substring-without-repeating-characters/submissions/") as any;

    expect(adapter.extractSlug()).toBe("longest-substring-without-repeating-characters");
  });

  it("extractTitle() should extract title from DOM heading and remove problem numbers", () => {
    document.body.innerHTML = `
      <div data-cy="question-title">1. Two Sum</div>
    `;
    expect(adapter.extractTitle("two-sum")).toBe("Two Sum");
  });

  it("extractDifficulty() should detect Easy, Medium, Hard correctly", () => {
    document.body.innerHTML = `
      <div class="text-olive">Easy</div>
    `;
    expect(adapter.extractDifficulty()).toBe("Easy");

    document.body.innerHTML = `
      <div class="text-yellow">Medium</div>
    `;
    expect(adapter.extractDifficulty()).toBe("Medium");

    document.body.innerHTML = `
      <div class="text-pink">Hard</div>
    `;
    expect(adapter.extractDifficulty()).toBe("Hard");
  });

  it("extractCode() should extract lines from Monaco editor DOM structure", async () => {
    document.body.innerHTML = `
      <div class="monaco-editor">
        <div class="view-lines">
          <div class="view-line"><span>class Solution:</span></div>
          <div class="view-line"><span>&nbsp;&nbsp;&nbsp;&nbsp;def twoSum(self):</span></div>
          <div class="view-line"><span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;return [0, 1]</span></div>
        </div>
      </div>
    `;

    const code = await adapter.extractCode();
    expect(code).toBe("class Solution:\n    def twoSum(self):\n        return [0, 1]");
  });

  it("getSubmissionStatus() should detect Accepted submission result", async () => {
    document.body.innerHTML = `
      <div data-e2e-locator="submission-result">
        <span class="text-green-500">Accepted</span>
      </div>
    `;

    const status = await adapter.getSubmissionStatus();
    expect(status).toBe("accepted");
  });

  it("getSubmissionStatus() should return failed for non-accepted results", async () => {
    document.body.innerHTML = `
      <div data-e2e-locator="submission-result">
        <span>Wrong Answer</span>
      </div>
    `;

    const status = await adapter.getSubmissionStatus();
    expect(status).toBe("failed");
  });

  it("getProblem() should assemble complete problem metadata", async () => {
    delete (window as any).location;
    window.location = new URL("https://leetcode.com/problems/valid-parentheses/") as any;

    document.body.innerHTML = `
      <div data-cy="question-title">20. Valid Parentheses</div>
      <div class="text-olive">Easy</div>
      <div data-track-load="description_content">Given a string s containing just the characters '(', ')', '{', '}', '[' and ']'...</div>
    `;

    const problem = await adapter.getProblem();
    expect(problem.slug).toBe("valid-parentheses");
    expect(problem.title).toBe("Valid Parentheses");
    expect(problem.difficulty).toBe("Easy");
    expect(problem.url).toBe("https://leetcode.com/problems/valid-parentheses/");
    expect(problem.statement).toContain("Given a string s");
  });
});

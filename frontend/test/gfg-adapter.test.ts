// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { GFGAdapter } from "../src/content/gfg/gfg-adapter.js";

describe("GFGAdapter", () => {
  let adapter: GFGAdapter;

  beforeEach(() => {
    adapter = new GFGAdapter();
    document.body.innerHTML = "";
    document.title = "";
  });

  it("detect() returns true for geeksforgeeks.org problem URLs", () => {
    delete (window as any).location;
    window.location = new URL("https://www.geeksforgeeks.org/problems/two-sum/") as any;
    expect(adapter.detect()).toBe(true);
  });

  it("detect() returns true for practice.geeksforgeeks.org problem URLs", () => {
    delete (window as any).location;
    window.location = new URL("https://practice.geeksforgeeks.org/problems/n-queen-problem/") as any;
    expect(adapter.detect()).toBe(true);
  });

  it("detect() returns false for non-problem GFG pages", () => {
    delete (window as any).location;
    window.location = new URL("https://www.geeksforgeeks.org/data-structures/") as any;
    expect(adapter.detect()).toBe(false);
  });

  it("detect() returns false for non-GFG sites", () => {
    delete (window as any).location;
    window.location = new URL("https://leetcode.com/problems/two-sum/") as any;
    expect(adapter.detect()).toBe(false);
  });

  it("extractSlug() extracts slug from pathname", () => {
    delete (window as any).location;
    window.location = new URL("https://www.geeksforgeeks.org/problems/n-queen-problem/") as any;
    expect(adapter.extractSlug()).toBe("n-queen-problem");
  });

  it("extractTitle() reads from h1 DOM element", () => {
    document.body.innerHTML = `<h1>N Queen Problem</h1>`;
    expect(adapter.extractTitle("n-queen-problem")).toBe("N Queen Problem");
  });

  it("extractTitle() falls back to slug-to-title conversion", () => {
    document.body.innerHTML = "";
    expect(adapter.extractTitle("n-queen-problem")).toBe("N Queen Problem");
  });

  it("extractTitle() strips leading problem numbers", () => {
    document.body.innerHTML = `<h1>14. Two Sum</h1>`;
    expect(adapter.extractTitle("two-sum")).toBe("Two Sum");
  });

  it("extractDifficulty() detects Easy correctly", () => {
    document.body.innerHTML = `<span class="difficulty">Easy</span>`;
    expect(adapter.extractDifficulty()).toBe("Easy");
  });

  it("extractDifficulty() detects Medium correctly", () => {
    document.body.innerHTML = `<span class="difficulty">Medium</span>`;
    expect(adapter.extractDifficulty()).toBe("Medium");
  });

  it("extractDifficulty() detects Hard correctly", () => {
    document.body.innerHTML = `<span class="difficulty">Hard</span>`;
    expect(adapter.extractDifficulty()).toBe("Hard");
  });

  it("extractDifficulty() falls back to broad scan", () => {
    document.body.innerHTML = `<div><p><span>Hard</span></p></div>`;
    expect(adapter.extractDifficulty()).toBe("Hard");
  });

  it("extractDifficulty() returns undefined when no difficulty found", () => {
    document.body.innerHTML = `<div>Some other text</div>`;
    expect(adapter.extractDifficulty()).toBeUndefined();
  });

  it("extractCode() reads from CodeMirror editor", async () => {
    document.body.innerHTML = `
      <div class="CodeMirror-code">
        <div class="CodeMirror-line"><span>def solve():</span></div>
        <div class="CodeMirror-line"><span>&nbsp;&nbsp;&nbsp;&nbsp;return 42</span></div>
      </div>
    `;
    const code = await adapter.extractCode();
    expect(code).toContain("def solve():");
    expect(code).toContain("return 42");
  });

  it("extractCode() reads from Monaco editor", async () => {
    document.body.innerHTML = `
      <div class="monaco-editor">
        <div class="view-lines">
          <div class="view-line"><span>class Solution:</span></div>
          <div class="view-line"><span>    pass</span></div>
        </div>
      </div>
    `;
    const code = await adapter.extractCode();
    expect(code).toContain("class Solution:");
  });

  it("extractCode() falls back to textarea", async () => {
    document.body.innerHTML = `<textarea>def hello(): pass</textarea>`;
    const code = await adapter.extractCode();
    expect(code).toBe("def hello(): pass");
  });

  it("extractCode() returns empty string when no editor found", async () => {
    document.body.innerHTML = `<div>No editor here</div>`;
    expect(await adapter.extractCode()).toBe("");
  });

  it("getSubmissionStatus() returns accepted when verdict div matches", async () => {
    document.body.innerHTML = `<div class="verdict">Accepted</div>`;
    const status = await adapter.getSubmissionStatus();
    expect(status).toBe("accepted");
  });

  it("getSubmissionStatus() returns accepted for 'Problem Solved' text", async () => {
    document.body.innerHTML = `<div class="result">Problem Solved</div>`;
    const status = await adapter.getSubmissionStatus();
    expect(status).toBe("accepted");
  });

  it("getSubmissionStatus() returns failed for wrong answer", async () => {
    document.body.innerHTML = `<div class="verdict">Wrong Answer</div>`;
    const status = await adapter.getSubmissionStatus();
    expect(status).toBe("failed");
  });

  it("getSubmissionStatus() returns failed when no verdict found", async () => {
    document.body.innerHTML = `<div>Loading...</div>`;
    const status = await adapter.getSubmissionStatus();
    expect(status).toBe("failed");
  });

  it("getProblem() assembles complete metadata", async () => {
    delete (window as any).location;
    window.location = new URL("https://www.geeksforgeeks.org/problems/two-sum/") as any;

    document.body.innerHTML = `
      <h1>Two Sum</h1>
      <span class="difficulty">Easy</span>
      <div class="problem-statement">Given an array, find two numbers that add up to target.</div>
    `;

    const problem = await adapter.getProblem();
    expect(problem.slug).toBe("two-sum");
    expect(problem.title).toBe("Two Sum");
    expect(problem.difficulty).toBe("Easy");
    expect(problem.url).toContain("two-sum");
    expect(problem.statement).toBeDefined();
  });

  it("adapter name is 'gfg'", () => {
    expect(adapter.name).toBe("gfg");
  });
});

import {
  Difficulty,
  PlatformAdapter,
  ProblemMetadata,
  SubmissionData,
  SubmissionStatus,
} from "@codesync/shared";
import { requestMainWorldCode } from "../adapter.js";

export class LeetCodeAdapter implements PlatformAdapter {
  readonly name = "leetcode" as const;

  detect(): boolean {
    if (typeof window === "undefined" || !window.location) {
      return false;
    }
    const hostname = window.location.hostname;
    const isLeetCode = hostname.includes("leetcode.com") || hostname.includes("leetcode.cn");
    const isProblemPage = /\/problems\/([^/?#]+)/i.test(window.location.pathname);
    return isLeetCode && isProblemPage;
  }

  async getProblem(): Promise<ProblemMetadata> {
    const slug = this.extractSlug();
    const title = this.extractTitle(slug);
    const difficulty = this.extractDifficulty();
    const statement = this.extractStatement();
    const url = `https://leetcode.com/problems/${slug}/`;

    return {
      title,
      slug,
      url,
      difficulty,
      statement,
    };
  }

  async getSubmission(): Promise<SubmissionData> {
    const status = await this.getSubmissionStatus();
    const language = this.extractLanguage();
    const code = await this.extractCode();
    const submittedAt = new Date().toISOString();

    return {
      status,
      language,
      code,
      submittedAt,
    };
  }

  async getSubmissionStatus(): Promise<SubmissionStatus> {
    if (typeof document === "undefined") {
      return "failed";
    }

    // Check modern submission result panel
    const resultElements = [
      document.querySelector('[data-e2e-locator="submission-result"]'),
      document.querySelector('[data-cy="submission-result"]'),
      ...Array.from(document.querySelectorAll("span, div")).filter((el) => {
        const text = el.textContent?.trim() || "";
        return (
          text === "Accepted" ||
          text === "Wrong Answer" ||
          text === "Time Limit Exceeded" ||
          text === "Runtime Error"
        );
      }),
    ];

    for (const el of resultElements) {
      if (!el) continue;
      const text = el.textContent?.trim() || "";
      if (text === "Accepted") {
        return "accepted";
      }
    }

    // Check status in submission details tab
    const statusBadge = document.querySelector(
      'span[class*="text-green"], span[class*="text-olive"], span[class*="text-success"]'
    );
    if (statusBadge && statusBadge.textContent?.trim() === "Accepted") {
      return "accepted";
    }

    return "failed";
  }

  // ==========================================
  // Helper Extractors
  // ==========================================

  public extractSlug(): string {
    if (typeof window === "undefined" || !window.location) {
      return "unknown-problem";
    }
    const match = window.location.pathname.match(/\/problems\/([^/?#]+)/i);
    return match ? match[1] : "unknown-problem";
  }

  public extractTitle(slugFallback: string): string {
    if (typeof document === "undefined") {
      return this.slugToTitle(slugFallback);
    }

    // Try finding title in heading / header elements
    const selectors = [
      '[data-cy="question-title"]',
      'div[class*="text-title-large"]',
      'a[href*="/problems/"][class*="text-title"]',
      'div[class*="title__"]',
      "h4",
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        const raw = el.textContent.trim();
        // Remove leading numbering like "1. Two Sum" -> "Two Sum"
        return raw.replace(/^\d+\.\s*/, "");
      }
    }

    // Fallback: parse document title e.g. "Two Sum - LeetCode"
    if (document.title) {
      const titleMatch = document.title.split("-")[0]?.trim();
      if (titleMatch && !titleMatch.toLowerCase().includes("leetcode")) {
        return titleMatch.replace(/^\d+\.\s*/, "");
      }
    }

    return this.slugToTitle(slugFallback);
  }

  public extractDifficulty(): Difficulty | undefined {
    if (typeof document === "undefined") {
      return undefined;
    }

    // 1. Check specific LeetCode difficulty classes (Easy: olive/teal/green/easy, Medium: yellow/amber/orange/medium, Hard: pink/red/rose/hard)
    const easySelectors = [
      'div[class*="text-olive"]',
      'div[class*="text-teal"]',
      'div[class*="text-green"]',
      'div[class*="text-easy"]',
      '[class*="difficulty-easy"]',
      '[data-difficulty="Easy"]',
    ];
    for (const sel of easySelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim().toLowerCase() === "easy") return "Easy";
    }

    const mediumSelectors = [
      'div[class*="text-yellow"]',
      'div[class*="text-amber"]',
      'div[class*="text-orange"]',
      'div[class*="text-medium"]',
      '[class*="difficulty-medium"]',
      '[data-difficulty="Medium"]',
    ];
    for (const sel of mediumSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim().toLowerCase() === "medium") return "Medium";
    }

    const hardSelectors = [
      'div[class*="text-pink"]',
      'div[class*="text-red"]',
      'div[class*="text-rose"]',
      'div[class*="text-hard"]',
      '[class*="difficulty-hard"]',
      '[data-difficulty="Hard"]',
    ];
    for (const sel of hardSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim().toLowerCase() === "hard") return "Hard";
    }

    // 2. Scoped header check: look only inside description/header container
    const headerContainer = document.querySelector(
      'div[class*="flex"][class*="items-center"], [data-cy="question-title"]'
    )?.parentElement;
    if (headerContainer) {
      const badges = headerContainer.querySelectorAll("div, span");
      for (const badge of Array.from(badges)) {
        const text = badge.textContent?.trim();
        if (text === "Easy") return "Easy";
        if (text === "Medium") return "Medium";
        if (text === "Hard") return "Hard";
      }
    }

    return undefined;
  }

  public extractStatement(): string | undefined {
    if (typeof document === "undefined") {
      return undefined;
    }

    const selectors = [
      '[data-track-load="description_content"]',
      'div[class*="elfjS"]',
      'div[class*="question-content"]',
      'div[class*="content__"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }

    return undefined;
  }

  public extractLanguage(): string {
    if (typeof document === "undefined") {
      return "python3";
    }

    // Language dropdown buttons
    const selectors = [
      'button[id*="headlessui-listbox-button"]',
      'button[data-cy="lang-select"]',
      'button[class*="rounded"][class*="text-xs"]',
      'div[class*="lang-select"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        const text = el.textContent.trim();
        const normalized = this.normalizeLanguage(text);
        if (normalized) return normalized;
      }
    }

    return "python3"; // Default fallback
  }

  async extractCode(): Promise<string> {
    if (typeof document === "undefined") {
      return "";
    }

    // Method 1: Request Monaco/ACE code from MAIN world via postMessage bridge (avoids CSP violation)
    const monacoCode = await requestMainWorldCode();
    if (monacoCode && monacoCode.trim().length > 0) {
      return monacoCode.trim();
    }

    // Method 2: Check full code block in submission detail / result panel
    const codeBlocks = [
      document.querySelector('[data-e2e-locator="submission-code"] code'),
      document.querySelector('[data-e2e-locator="submission-code"] pre'),
      document.querySelector('div[class*="code-area"] pre'),
      document.querySelector('div[class*="submission"] pre code'),
    ];

    for (const block of codeBlocks) {
      if (block && block.textContent?.trim()) {
        return block.textContent.trim();
      }
    }

    // Method 3: Monaco Editor lines (.view-lines .view-line) sorted by vertical position
    const viewLines = document.querySelectorAll(".monaco-editor .view-lines .view-line");
    if (viewLines && viewLines.length > 0) {
      const sortedLines = Array.from(viewLines).sort((a, b) => {
        const topA =
          parseFloat((a as HTMLElement).style?.top || "0") ||
          (a as HTMLElement).offsetTop ||
          0;
        const topB =
          parseFloat((b as HTMLElement).style?.top || "0") ||
          (b as HTMLElement).offsetTop ||
          0;
        return topA - topB;
      });

      const lines = sortedLines.map((line) => {
        return (line.textContent || "").replace(/\u00a0/g, " ");
      });
      return lines.join("\n").trim();
    }

    // Method 4: CodeMirror lines
    const cmLines = document.querySelectorAll(".CodeMirror-code > div");
    if (cmLines && cmLines.length > 0) {
      const lines = Array.from(cmLines).map((line) => {
        return (line.textContent || "").replace(/\u00a0/g, " ");
      });
      return lines.join("\n").trim();
    }

    // Method 5: Textarea
    const textarea = document.querySelector(
      "textarea.monaco-mouse-cursor-text, textarea[name*='code']"
    );
    if (textarea && (textarea as HTMLTextAreaElement).value) {
      return (textarea as HTMLTextAreaElement).value.trim();
    }

    return "";
  }


  private normalizeLanguage(raw: string): string {
    const lower = raw.toLowerCase().trim();
    if (lower.includes("python3") || lower === "python 3") return "python3";
    if (lower === "python" || lower.includes("python")) return "python";
    if (lower.includes("c++") || lower === "cpp") return "cpp";
    if (lower.includes("java") && !lower.includes("script")) return "java";
    if (lower.includes("javascript") || lower === "js") return "javascript";
    if (lower.includes("typescript") || lower === "ts") return "typescript";
    if (lower.includes("golang") || lower === "go") return "go";
    if (lower.includes("rust")) return "rust";
    if (lower.includes("c#") || lower === "csharp") return "csharp";
    if (lower.includes("c")) return "c";
    return lower.replace(/[^a-z0-9]/g, "");
  }

  private slugToTitle(slug: string): string {
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
}

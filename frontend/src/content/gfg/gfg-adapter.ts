import {
  Difficulty,
  PlatformAdapter,
  ProblemMetadata,
  SubmissionData,
  SubmissionStatus,
} from "@codesync/shared";
import { requestMainWorldCode } from "../adapter.js";

/**
 * Platform adapter for GeeksForGeeks (geeksforgeeks.org & practice.geeksforgeeks.org).
 *
 * Supports standard /problems/ pages, batch/course tracks, and contest interfaces.
 * Extracts full unvirtualized code from Monaco, ACE, and CodeMirror.
 */
export class GFGAdapter implements PlatformAdapter {
  readonly name = "gfg" as const;

  detect(): boolean {
    if (typeof window === "undefined" || !window.location) {
      return false;
    }
    const hostname = window.location.hostname;
    const isGFG = hostname.includes("geeksforgeeks.org");
    const path = window.location.pathname.toLowerCase();
    const isProblemPage =
      path.includes("/problems/") ||
      path.includes("/batch/") ||
      path.includes("/contest/") ||
      (path.includes("/practice/") && !path.includes("/explore"));

    return isGFG && isProblemPage;
  }

  async getProblem(): Promise<ProblemMetadata> {
    const slug = this.extractSlug();
    const title = this.extractTitle(slug);
    const difficulty = this.extractDifficulty();
    const statement = this.extractStatement();
    const url = `https://www.geeksforgeeks.org/problems/${slug}/1`;

    return { title, slug, url, difficulty, statement };
  }

  async getSubmission(): Promise<SubmissionData> {
    const status = await this.getSubmissionStatus();
    const language = this.extractLanguage();
    const code = await this.extractCode();
    const submittedAt = new Date().toISOString();

    return { status, language, code, submittedAt };
  }

  async getSubmissionStatus(): Promise<SubmissionStatus> {
    if (typeof document === "undefined") return "failed";

    const acceptedPhrases = [
      "problem solved successfully",
      "problem solved",
      "correct answer",
      "accepted",
      "all test cases passed",
      "100% test cases passed",
      "all test cases have been passed",
      "points scored",
      "1/1",
      "solved",
    ];

    // 1. Check GFG modern React modal/popup verdict area
    const modernSelectors = [
      'div[class*="modal"]',
      'div[role="dialog"]',
      'div[class*="verdict"]',
      'div[class*="Verdict"]',
      'div[class*="submission"]',
      'div[class*="Submission"]',
      'div[class*="result"]',
      'div[class*="Result"]',
      'div[class*="feedback"]',
      'div[class*="compile"]',
      'div[class*="output"]',
    ];

    for (const sel of modernSelectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of Array.from(elements)) {
        const txt = el.textContent?.trim().toLowerCase() || "";
        if (acceptedPhrases.some((p) => txt.includes(p))) {
          return "accepted";
        }
      }
    }

    // 2. Look for green-colored success text (GFG marks accepted in green)
    const greenElements = document.querySelectorAll(
      '[class*="green"], [class*="success"], [class*="correct"], [class*="tick"], [style*="color: green"], [style*="color:#"], [class*="ac"]'
    );
    for (const el of Array.from(greenElements)) {
      const txt = el.textContent?.trim().toLowerCase() || "";
      if (
        txt === "accepted" ||
        txt === "correct answer" ||
        txt === "problem solved" ||
        txt === "solved" ||
        txt.includes("all test cases passed") ||
        txt.includes("100%")
      ) {
        return "accepted";
      }
    }

    // 3. Check page-level headings / prominent text
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const el of Array.from(headings)) {
      const txt = el.textContent?.trim().toLowerCase() || "";
      if (acceptedPhrases.some((p) => txt.includes(p))) return "accepted";
    }

    // 4. Final broad scan on standalone exact-match text nodes
    const candidates = document.querySelectorAll("span, p, div");
    for (const el of Array.from(candidates)) {
      // Only look at leaf-like elements (short text, no deep children)
      if (el.children.length > 3) continue;
      const txt = el.textContent?.trim().toLowerCase() || "";
      if (
        txt === "accepted" ||
        txt === "correct answer" ||
        txt === "problem solved" ||
        txt === "solved" ||
        txt === "problem solved successfully"
      ) {
        return "accepted";
      }
    }

    return "failed";
  }

  // ==========================================
  // Helper Extractors
  // ==========================================

  public extractSlug(): string {
    if (typeof window === "undefined" || !window.location) return "unknown-problem";
    const path = window.location.pathname;

    // e.g. /problems/two-sum/1 -> two-sum
    const match = path.match(/\/problems\/([^/?#]+)/i);
    if (match && match[1]) {
      return match[1].replace(/\/1$/, "").trim();
    }

    // e.g. /batch/gfg-160/track/two-sum/problem/...
    const trackMatch = path.match(/track\/([^/?#]+)/i);
    if (trackMatch && trackMatch[1]) {
      return trackMatch[1];
    }

    return "unknown-problem";
  }

  public extractTitle(slugFallback: string): string {
    if (typeof document === "undefined") return this.slugToTitle(slugFallback);

    const selectors = [
      'h1[class*="problem-title"]',
      'h3[class*="problem-title"]',
      '[class*="problem-name"]',
      '[class*="problemTitle"]',
      "h1",
      "h2",
      "h3",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        const raw = el.textContent.trim();
        // Remove leading numbering like "1. Two Sum" -> "Two Sum"
        return raw.replace(/^\d+\.\s*/, "").replace(/\s*\(.*?\)$/, "");
      }
    }

    if (document.title) {
      const parts = document.title.split(" - ");
      if (parts[0] && !parts[0].toLowerCase().includes("geeksforgeeks")) {
        return parts[0].replace(/^\d+\.\s*/, "").trim();
      }
    }

    return this.slugToTitle(slugFallback);
  }

  public extractDifficulty(): Difficulty | undefined {
    if (typeof document === "undefined") return undefined;

    // GFG uses multiple formats across old and new UI — check all of them

    // 1. Specific data attribute selectors
    const dataAttrEl = document.querySelector(
      '[data-difficulty], [class*="difficulty"], [class*="Difficulty"], [class*="diffLevel"], [class*="problem-difficulty"]'
    );
    if (dataAttrEl) {
      const text = (
        dataAttrEl.getAttribute("data-difficulty") || dataAttrEl.textContent || ""
      ).toLowerCase().trim();
      if (text.includes("basic") || text.includes("school")) return "Basic";
      if (text.includes("easy")) return "Easy";
      if (text.includes("medium")) return "Medium";
      if (text.includes("hard")) return "Hard";
    }

    // 2. Color-coded difficulty pills (GFG uses green=Easy, yellow=Medium, red=Hard)
    const colorMap: Array<[string, Difficulty]> = [
      ['[class*="Basic"], [class*="basic"], [class*="school"]', "Basic"],
      ['[class*="Easy"], [class*="easy"], [class*="green"], [class*="text-green"]', "Easy"],
      ['[class*="Medium"], [class*="medium"], [class*="yellow"], [class*="text-yellow"], [class*="orange"]', "Medium"],
      ['[class*="Hard"], [class*="hard"], [class*="red"], [class*="text-red"]', "Hard"],
    ];
    for (const [sel, difficulty] of colorMap) {
      for (const sel2 of sel.split(", ")) {
        const el = document.querySelector(sel2.trim());
        if (el) {
          const txt = el.textContent?.trim().toLowerCase() || "";
          if (txt === "basic" || txt === "school") return "Basic";
          if (txt === "easy") return "Easy";
          if (txt === "medium") return "Medium";
          if (txt === "hard") return "Hard";
          if (txt === difficulty.toLowerCase()) return difficulty;
        }
      }
    }

    // 3. Broad text scan on small elements (badges/chips)
    const badgeEls = document.querySelectorAll(
      "span, div[class*='badge'], div[class*='pill'], div[class*='tag'], div[class*='chip'], p"
    );
    for (const el of Array.from(badgeEls)) {
      const txt = el.textContent?.trim().toLowerCase() || "";
      if (txt === "basic" || txt === "school") return "Basic";
      if (txt === "easy") return "Easy";
      if (txt === "medium") return "Medium";
      if (txt === "hard") return "Hard";
    }

    return undefined;
  }

  public extractStatement(): string | undefined {
    if (typeof document === "undefined") return undefined;

    const selectors = [
      '[class*="problem-statement"]',
      '[class*="problemStatement"]',
      '[class*="question-details"]',
      '[class*="problem-description"]',
      '[class*="content"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }

    return undefined;
  }

  public extractLanguage(): string {
    if (typeof document === "undefined") return "python3";

    const selectors = [
      'select[name*="language"]',
      'select[id*="language"]',
      '[class*="language-select"]',
      '[class*="languageSelector"]',
      'button[class*="lang"]',
      "[data-language]",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      if (el.tagName === "SELECT") {
        const selected = (el as HTMLSelectElement).options[(el as HTMLSelectElement).selectedIndex];
        if (selected?.text) return this.normalizeLanguage(selected.text);
      }

      const dataLang = el.getAttribute("data-language");
      if (dataLang) return this.normalizeLanguage(dataLang);

      if (el.textContent?.trim()) return this.normalizeLanguage(el.textContent.trim());
    }

    return "python3";
  }

  public async extractCode(): Promise<string> {
    if (typeof document === "undefined") return "";

    // Method 1: Request Monaco/ACE code from MAIN world via postMessage bridge (avoids CSP violation)
    const monacoCode = await requestMainWorldCode();
    if (monacoCode && monacoCode.trim().length > 0) {
      return monacoCode.trim();
    }

    // Method 2: CodeMirror editor
    const cmCode = document.querySelector(".CodeMirror-code");
    if (cmCode) {
      const lines = Array.from(cmCode.querySelectorAll(".CodeMirror-line"));
      if (lines.length > 0) {
        return lines
          .map((line) => (line.textContent || "").replace(/\u00a0/g, " "))
          .join("\n")
          .trim();
      }
    }

    // Method 3: Monaco DOM view lines
    const monacoLines = document.querySelectorAll(".monaco-editor .view-lines .view-line");
    if (monacoLines.length > 0) {
      const sortedLines = Array.from(monacoLines).sort((a, b) => {
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

      return sortedLines
        .map((line) => (line.textContent || "").replace(/\u00a0/g, " "))
        .join("\n")
        .trim();
    }

    // Method 4: ACE editor
    const aceLines = document.querySelectorAll(".ace_content .ace_line");
    if (aceLines.length > 0) {
      return Array.from(aceLines)
        .map((line) => (line.textContent || "").replace(/\u00a0/g, " "))
        .join("\n")
        .trim();
    }

    // Method 5: Plain textarea
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    if (textarea?.value) {
      return textarea.value.trim();
    }

    return "";
  }


  private normalizeLanguage(raw: string): string {
    const lower = raw.toLowerCase().trim();
    if (lower.includes("python3") || lower === "python 3") return "python3";
    if (lower.includes("python")) return "python";
    if (lower.includes("c++") || lower === "cpp") return "cpp";
    if (lower.includes("java") && !lower.includes("script")) return "java";
    if (lower.includes("javascript") || lower === "js") return "javascript";
    if (lower.includes("typescript") || lower === "ts") return "typescript";
    if (lower.includes("golang") || lower === "go") return "go";
    if (lower.includes("rust")) return "rust";
    if (lower.includes("c#") || lower === "csharp") return "csharp";
    if (lower === "c") return "c";
    return lower.replace(/[^a-z0-9]/g, "");
  }

  private slugToTitle(slug: string): string {
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
}

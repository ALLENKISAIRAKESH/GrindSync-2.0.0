import { describe, it, expect } from "vitest";
import { sanitizeSegment, resolveSafeRepoPath, SecurityError } from "../src/services/path-sanitizer.js";
import path from "path";
import os from "os";

describe("sanitizeSegment", () => {
  it("returns a clean slug for normal titles", () => {
    expect(sanitizeSegment("Two Sum")).toBe("Two-Sum");
    expect(sanitizeSegment("Longest Substring Without Repeating Characters")).toBe(
      "Longest-Substring-Without-Repeating-Characters"
    );
  });

  it("strips illegal filesystem characters", () => {
    expect(sanitizeSegment("Two Sum Fast")).toBe("Two-Sum-Fast");
    expect(sanitizeSegment("Hello<World>")).toBe("Hello-World");
    expect(sanitizeSegment("pipe|test")).toBe("pipe-test");
  });

  it("removes path separators to prevent injection", () => {
    const result = sanitizeSegment("../../etc/passwd");
    // Must not contain path separators or traversal sequences
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("rejects pure traversal sequences as fallback", () => {
    expect(sanitizeSegment("..")).toBe("unknown");
    expect(sanitizeSegment(".")).toBe("unknown");
    expect(sanitizeSegment("  ..  ")).toBe("unknown");
  });

  it("collapses multiple dashes/spaces", () => {
    expect(sanitizeSegment("a   b")).toBe("a-b");
    expect(sanitizeSegment("a---b")).toBe("a-b");
  });

  it("trims leading/trailing dots and dashes", () => {
    expect(sanitizeSegment("...hidden")).toBe("hidden");
    expect(sanitizeSegment("-leading")).toBe("leading");
    expect(sanitizeSegment("trailing-")).toBe("trailing");
  });

  it("handles Windows reserved names", () => {
    expect(sanitizeSegment("CON")).toBe("_CON");
    expect(sanitizeSegment("NUL")).toBe("_NUL");
    expect(sanitizeSegment("COM1")).toBe("_COM1");
    expect(sanitizeSegment("LPT9")).toBe("_LPT9");
  });

  it("returns fallback for empty input", () => {
    expect(sanitizeSegment("")).toBe("unknown");
    expect(sanitizeSegment("   ")).toBe("unknown");
  });

  it("returns fallback with custom fallback param", () => {
    expect(sanitizeSegment("", "fallback")).toBe("fallback");
  });

  it("enforces maximum length", () => {
    const long = "a".repeat(200);
    expect(sanitizeSegment(long).length).toBeLessThanOrEqual(128);
  });

  it("strips control characters", () => {
    const result = sanitizeSegment("hello\x00world");
    expect(result).not.toContain("\x00");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });
});

describe("resolveSafeRepoPath", () => {
  const tmpRoot = path.join(os.tmpdir(), "codesync-test-root");

  it("resolves valid subpaths correctly", () => {
    const result = resolveSafeRepoPath(tmpRoot, "LeetCode", "Easy", "Two-Sum");
    expect(result.startsWith(path.resolve(tmpRoot))).toBe(true);
    expect(result).toContain("LeetCode");
    expect(result).toContain("Two-Sum");
  });

  it("throws SecurityError for raw path traversal segments", () => {
    expect(() =>
      resolveSafeRepoPath(tmpRoot, "..", "..", "etc", "passwd")
    ).toThrow(SecurityError);
  });

  it("throws SecurityError for single dot segment", () => {
    // Single "." is a traversal/self-reference we explicitly block
    expect(() =>
      resolveSafeRepoPath(tmpRoot, ".")
    ).toThrow(SecurityError);
  });

  it("sanitizes segments before resolving - no illegal chars in segment names", () => {
    const result = resolveSafeRepoPath(tmpRoot, "LeetCode", "Easy", "Two Sum: C++");
    // The problem-name segment itself must be sanitized
    const problemSegment = path.basename(path.dirname(result));
    expect(problemSegment).not.toContain(":");
    expect(problemSegment).not.toContain("+");
    expect(problemSegment).not.toContain(" ");
  });
});

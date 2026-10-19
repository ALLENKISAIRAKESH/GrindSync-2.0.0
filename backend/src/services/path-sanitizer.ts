import path from "path";

/**
 * Characters that are illegal in Windows, Linux, or macOS filenames.
 * Also includes path separators and other characters that have no place in a safe segment.
 */
const ILLEGAL_CHARS = /[<>:"/\\|?*+#%&={}^~[\]`'\x00-\x1F]/g;

/**
 * Windows reserved device names (case-insensitive).
 * Writing to these causes OS-level issues on Windows.
 */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Maximum length for a single path segment (filesystem safe on most OSes).
 */
const MAX_SEGMENT_LENGTH = 128;

/**
 * Sanitize a single path segment (filename or directory name).
 *
 * Security guarantees:
 * - Strips illegal/control characters
 * - Strips path separators (/ and \)
 * - Rejects Windows reserved names
 * - Collapses multiple dashes/spaces
 * - Trims leading/trailing dots and spaces
 * - Caps length to MAX_SEGMENT_LENGTH
 * - Returns a fallback if the result is empty
 */
export function sanitizeSegment(name: string, fallback = "unknown"): string {
  if (!name || typeof name !== "string") return fallback;

  // Immediately reject pure traversal sequences before any other processing
  const trimmed = name.trim();
  if (trimmed === "." || trimmed === ".." || trimmed === "" ) {
    return fallback;
  }

  let safe = name
    .replace(ILLEGAL_CHARS, "-")        // Replace illegal chars with dash
    .replace(/\.{2,}/g, "-")            // Replace .. sequences
    .replace(/\s+/g, "-")               // Collapse whitespace to dash
    .replace(/-{2,}/g, "-")             // Collapse multiple dashes
    .replace(/^[.\s-]+|[.\s-]+$/g, ""); // Trim leading/trailing dots, spaces, dashes

  if (!safe || safe === ".") {
    return fallback;
  }

  // Guard against Windows reserved names
  if (WINDOWS_RESERVED.test(safe)) {
    return `_${safe}`;
  }

  // Enforce length limit
  if (safe.length > MAX_SEGMENT_LENGTH) {
    safe = safe.slice(0, MAX_SEGMENT_LENGTH).replace(/[.\s-]+$/, "");
  }

  return safe || fallback;
}

/**
 * SecurityError thrown when a resolved path falls outside the allowed root.
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Resolve and validate that the resulting path is strictly inside repoRoot.
 *
 * Security guarantees:
 * - Resolves absolute paths
 * - Prevents path traversal attacks ("../../evil")
 * - Rejects absolute path segments
 * - Throws SecurityError if the path escapes the configured root
 */
export function resolveSafeRepoPath(repoRoot: string, ...segments: string[]): string {
  const absoluteRoot = path.resolve(repoRoot);

  // Explicitly reject raw traversal segments before sanitization
  for (const seg of segments) {
    const t = seg.trim();
    if (t === ".." || t === ".") {
      throw new SecurityError(
        `Path traversal detected: segment "${seg}" is not allowed`
      );
    }
  }

  // Sanitize each segment individually
  const safeSegments = segments.map((seg, i) => sanitizeSegment(seg, `segment_${i}`));

  const resolved = path.resolve(absoluteRoot, ...safeSegments);

  // Ensure the resolved path starts with absoluteRoot
  // Use path.sep to guard against prefix-bypass (e.g., /rootExtra vs /root)
  if (!resolved.startsWith(absoluteRoot + path.sep) && resolved !== absoluteRoot) {
    throw new SecurityError(
      `Path traversal detected: resolved path "${resolved}" is outside root "${absoluteRoot}"`
    );
  }

  return resolved;
}

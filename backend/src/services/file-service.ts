import fs from "fs/promises";
import path from "path";
import {
  SolutionSubmission,
  getPlatformDirectoryName,
  getLanguageExtension,
} from "@codesync/shared";
import { sanitizeSegment, resolveSafeRepoPath, SecurityError } from "./path-sanitizer.js";
import { renderInitialReadme } from "./readme-renderer.js";

export interface GeneratedFiles {
  solutionPath: string;
  readmePath: string;
  createdFiles: string[];
  updatedFiles: string[];
}

/**
 * Verifies the given path is a valid Git working tree root.
 * Checks for the presence of a `.git` directory.
 */
export async function verifyRepoRoot(repoRoot: string): Promise<void> {
  const gitDir = path.join(repoRoot, ".git");
  try {
    const stat = await fs.stat(gitDir);
    if (!stat.isDirectory()) {
      throw new Error(`"${repoRoot}" is not a valid Git repository (missing .git directory).`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`"${repoRoot}" is not a valid Git repository (missing .git directory).`);
    }
    throw err;
  }
}

/**
 * Generates the structured problem directory and writes the solution and README files.
 *
 * Directory structure:
 *   <repoRoot>/<Platform>/<Difficulty>/<SafeProblemName>/
 *     ├── README.md
 *     └── solution.<ext>                        (single language)
 *
 * Multi-language structure:
 *   <repoRoot>/<Platform>/<Difficulty>/<SafeProblemName>/
 *     ├── README.md
 *     ├── python/solution.py
 *     └── cpp/solution.cpp
 *
 * Security:
 * - All path segments are sanitized
 * - All resolved paths are verified to be within repoRoot
 * - Original code is written byte-for-byte without modification
 */
export async function generateSolutionFiles(
  repoRoot: string,
  submission: SolutionSubmission
): Promise<GeneratedFiles> {
  const { platform, problem, submission: sub } = submission;

  const platformDir = getPlatformDirectoryName(platform);
  const rawDiff = problem.difficulty?.trim();
  const difficultyDir = rawDiff && rawDiff !== "Unknown" ? rawDiff : "Medium";
  const problemDir = sanitizeSegment(problem.title, sanitizeSegment(problem.slug, "unknown-problem"));
  const ext = getLanguageExtension(sub.language);
  const lang = sub.language.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Build and validate the problem directory path
  const problemDirPath = resolveSafeRepoPath(repoRoot, platformDir, difficultyDir, problemDir);

  // Ensure the directory exists
  await fs.mkdir(problemDirPath, { recursive: true });

  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];

  // Determine if we should use multi-language or single-language structure
  // Multi-language: use a language subdirectory if another language solution already exists
  const useMultiLang = await shouldUseMultiLanguage(problemDirPath, lang, ext);

  let solutionPath: string;

  if (useMultiLang) {
    // Create language-specific subdirectory
    const langDirPath = resolveSafeRepoPath(repoRoot, platformDir, difficultyDir, problemDir, lang);
    await fs.mkdir(langDirPath, { recursive: true });
    solutionPath = path.join(langDirPath, `solution${ext}`);
  } else {
    solutionPath = path.join(problemDirPath, `solution${ext}`);
  }

  // Write the solution file — original, byte-for-byte preserved
  const solutionExists = await fileExists(solutionPath);
  await fs.writeFile(solutionPath, sub.code, { encoding: "utf8" });
  if (solutionExists) {
    updatedFiles.push(solutionPath);
  } else {
    createdFiles.push(solutionPath);
  }

  // Write the README file
  const readmePath = path.join(problemDirPath, "README.md");
  const readmeExists = await fileExists(readmePath);
  const readmeContent = renderInitialReadme(submission);
  await fs.writeFile(readmePath, readmeContent, { encoding: "utf8" });
  if (readmeExists) {
    updatedFiles.push(readmePath);
  } else {
    createdFiles.push(readmePath);
  }

  return { solutionPath, readmePath, createdFiles, updatedFiles };
}

/**
 * Checks if an existing solution directory already contains solutions in
 * a different language. If so, multi-language mode is activated.
 */
async function shouldUseMultiLanguage(
  problemDirPath: string,
  currentLang: string,
  currentExt: string
): Promise<boolean> {
  try {
    const entries = await fs.readdir(problemDirPath);
    for (const entry of entries) {
      // If there's already a solution file in a different extension, go multi-lang
      if (entry.startsWith("solution") && !entry.endsWith(currentExt)) {
        return true;
      }
      // If there's a language subdirectory that is not the current lang
      const entryPath = path.join(problemDirPath, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory() && entry !== currentLang && entry !== ".git") {
        return true;
      }
    }
  } catch {
    // Directory doesn't exist yet or other error — default to single-lang
  }
  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

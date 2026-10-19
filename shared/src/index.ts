import { z } from "zod";

// ==========================================
// Health Schemas & Types
// ==========================================
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ==========================================
// Submission Schemas & Types
// ==========================================
export const PlatformSchema = z.enum(["leetcode", "gfg"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const DifficultySchema = z.enum(["Basic", "Easy", "Medium", "Hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const ProblemMetadataSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  url: z.string().url("Invalid problem URL"),
  difficulty: DifficultySchema.optional(),
  statement: z.string().optional(),
});
export type ProblemMetadata = z.infer<typeof ProblemMetadataSchema>;

export const SubmissionStatusSchema = z.enum(["accepted", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const SubmissionDataSchema = z.object({
  status: SubmissionStatusSchema,
  language: z.string().min(1, "Language is required"),
  code: z.string().min(1, "Code cannot be empty"),
  submittedAt: z.string().datetime().or(z.string().min(1)),
});
export type SubmissionData = z.infer<typeof SubmissionDataSchema>;

export const SolutionSubmissionSchema = z.object({
  platform: PlatformSchema,
  problem: ProblemMetadataSchema,
  submission: SubmissionDataSchema,
  repoPath: z.string().optional(),
});
export type SolutionSubmission = z.infer<typeof SolutionSubmissionSchema>;

// ==========================================
// Platform Adapter Interface
// ==========================================
export interface PlatformAdapter {
  readonly name: Platform;
  detect(): boolean;
  getProblem(): Promise<ProblemMetadata>;
  getSubmission(): Promise<SubmissionData>;
  getSubmissionStatus(): Promise<SubmissionStatus>;
}

// ==========================================
// Language & Platform Helpers
// ==========================================
export function getPlatformDirectoryName(platform: Platform): string {
  switch (platform) {
    case "leetcode":
      return "LeetCode";
    case "gfg":
      return "GeeksForGeeks";
    default:
      return platform;
  }
}

export function getLanguageExtension(language: string): string {
  const normalized = language.toLowerCase().trim().replace(/[^a-z0-9#+]/g, "");

  const map: Record<string, string> = {
    python3: ".py",
    python: ".py",
    py: ".py",
    cpp: ".cpp",
    "c++": ".cpp",
    cxx: ".cpp",
    cc: ".cpp",
    c: ".c",
    java: ".java",
    javascript: ".js",
    js: ".js",
    nodejs: ".js",
    typescript: ".ts",
    ts: ".ts",
    golang: ".go",
    go: ".go",
    rust: ".rs",
    rs: ".rs",
    csharp: ".cs",
    "c#": ".cs",
    cs: ".cs",
    kotlin: ".kt",
    kt: ".kt",
    swift: ".swift",
    ruby: ".rb",
    rb: ".rb",
    scala: ".scala",
    php: ".php",
    r: ".r",
    dart: ".dart",
    sql: ".sql",
    bash: ".sh",
    sh: ".sh",
  };

  return map[normalized] || ".txt";
}

// ==========================================
// Job Schemas & Types
// ==========================================
export const JobStatusSchema = z.enum([
  "queued",
  "processing",
  "generating",
  "writing",
  "committing",
  "pushing",
  "completed",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const SubmissionResponseSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  message: z.string().optional(),
  files: z.array(z.string()).optional(),
});
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;

export const JobResponseSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  error: z.string().nullable().optional(),
  files: z.array(z.string()).optional(),
  completedAt: z.string().nullable().optional(),
});
export type JobResponse = z.infer<typeof JobResponseSchema>;

// ==========================================
// AI Explanation Schema
// ==========================================
export const ExplanationOutputSchema = z.object({
  approach: z.string(),
  intuition: z.string(),
  analogy: z.string().optional(),
  mermaid_diagram: z.string().optional(),
  visual_dry_run: z.string().optional(),
  step_by_step: z.string(),
  why_it_works: z.string(),
  time_complexity: z.string(),
  space_complexity: z.string(),
  edge_cases: z.array(z.string()),
});
export type ExplanationOutput = z.infer<typeof ExplanationOutputSchema>;

// ==========================================
// Extension Configuration & Storage
// ==========================================
export const ExplanationStyleSchema = z.enum(["short", "detailed", "interview"]);
export type ExplanationStyle = z.infer<typeof ExplanationStyleSchema>;

export const ExtensionConfigSchema = z.object({
  agentUrl: z.string().default("http://127.0.0.1:4578"),
  bearerToken: z.string().default("codesync-local-dev-token"),
  autoSync: z.boolean().default(true),
  aiExplanation: z.boolean().default(true),
  explanationStyle: ExplanationStyleSchema.default("detailed"),
  autoCommit: z.boolean().default(true),
  autoPush: z.boolean().default(false),
  repoPath: z.string().default(""),
  commitFormat: z.string().default("feat({platform}): add {problem}"),
  platforms: z
    .object({
      leetcode: z.boolean().default(true),
      gfg: z.boolean().default(true),
    })
    .default({ leetcode: true, gfg: true }),
  leetcodeUsername: z.string().optional().default(""),
  gfgUsername: z.string().optional().default(""),
});
export type ExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

export const BulkSubmissionPayloadSchema = z.object({
  submissions: z.array(SolutionSubmissionSchema),
  repoPath: z.string().optional(),
});
export type BulkSubmissionPayload = z.infer<typeof BulkSubmissionPayloadSchema>;

export const BulkSubmissionResponseSchema = z.object({
  success: z.boolean(),
  total: z.number(),
  syncedCount: z.number(),
  duplicateCount: z.number(),
  commitHash: z.string().optional(),
  pushed: z.boolean().optional(),
  pushError: z.string().optional(),
  message: z.string(),
});
export type BulkSubmissionResponse = z.infer<typeof BulkSubmissionResponseSchema>;

export const AgentStatusSchema = z.object({
  connected: z.boolean(),
  version: z.string().optional(),
  lastChecked: z.string(),
  error: z.string().optional(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// ==========================================
// Extension Internal Messages
// ==========================================
export type ExtensionMessage =
  | { type: "GET_AGENT_STATUS" }
  | { type: "CHECK_AGENT_CONNECTION" }
  | { type: "GET_CONFIG" }
  | { type: "SET_CONFIG"; payload: Partial<ExtensionConfig> }
  | { type: "SUBMIT_SOLUTION"; payload: SolutionSubmission }
  | { type: "SUBMIT_BULK_SOLUTIONS"; payload: BulkSubmissionPayload }
  | { type: "SYNC_HISTORICAL_SUBMISSIONS"; payload?: { maxCount?: number } };


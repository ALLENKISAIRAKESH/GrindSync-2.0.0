import dotenv from "dotenv";

dotenv.config();

export interface AgentConfig {
  host: string;
  port: number;
  bearerToken: string;
  version: string;
  nodeEnv: string;
  repoPath?: string;
  openaiApiKey?: string;
  autoPush: boolean;
  commitFormat: string;
}

export function loadConfig(): AgentConfig {
  // Non-negotiable security requirement: strictly bind to loopback address (127.0.0.1)
  const host = "127.0.0.1";
  const port = parseInt(process.env.PORT || "4578", 10);
  const bearerToken =
    process.env.GRINDSYNC_TOKEN ||
    process.env.CODESYNC_TOKEN ||
    "grindsync-local-dev-token";
  const version = "0.1.0";
  const nodeEnv = process.env.NODE_ENV || "development";
  const repoPath = process.env.CODESYNC_REPO_PATH;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const autoPush = process.env.CODESYNC_AUTO_PUSH === "true";
  const commitFormat = process.env.CODESYNC_COMMIT_FORMAT || "feat({platform}): add {problem}";

  return {
    host,
    port,
    bearerToken,
    version,
    nodeEnv,
    repoPath,
    openaiApiKey,
    autoPush,
    commitFormat,
  };
}

export const config = loadConfig();

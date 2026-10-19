import { ExtensionConfig, ExtensionConfigSchema, AgentStatus, AgentStatusSchema } from "@codesync/shared";

const DEFAULT_CONFIG: ExtensionConfig = {
  agentUrl: "http://127.0.0.1:4578",
  bearerToken: "codesync-local-dev-token",
  autoSync: true,
  aiExplanation: true,
  explanationStyle: "detailed",
  autoCommit: true,
  autoPush: true,
  repoPath: "C:\\Users\\ALLEN\\My-Leet-Code-",
  commitFormat: "feat({platform}): add {problem}",
  platforms: {
    leetcode: true,
    gfg: true,
  },
  leetcodeUsername: "",
  gfgUsername: "",
};

const DEFAULT_STATUS: AgentStatus = {
  connected: false,
  lastChecked: new Date(0).toISOString(),
  error: "Not checked yet",
};

export async function getConfig(): Promise<ExtensionConfig> {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const result = await chrome.storage.local.get("config");
    if (result && result.config) {
      const parsed = ExtensionConfigSchema.safeParse(result.config);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return DEFAULT_CONFIG;
}

export async function setConfig(config: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  const current = await getConfig();
  const updated = { ...current, ...config };
  const validated = ExtensionConfigSchema.parse(updated);

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ config: validated });
  }

  return validated;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const result = await chrome.storage.local.get("agentStatus");
    if (result && result.agentStatus) {
      const parsed = AgentStatusSchema.safeParse(result.agentStatus);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return DEFAULT_STATUS;
}

export async function setAgentStatus(status: AgentStatus): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ agentStatus: status });
  }
}

import { HealthResponseSchema, AgentStatus, ExtensionMessage, SubmissionResponseSchema } from "@codesync/shared";
import { getConfig, setConfig, getAgentStatus, setAgentStatus } from "../storage/config.js";

export async function checkAgentConnection(): Promise<AgentStatus> {
  const config = await getConfig();
  const url = `${config.agentUrl.replace(/\/+$/, "")}/health`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorStatus: AgentStatus = {
        connected: false,
        lastChecked: new Date().toISOString(),
        error: `Agent returned HTTP ${response.status}`,
      };
      await setAgentStatus(errorStatus);
      return errorStatus;
    }

    const data = await response.json();
    const parsed = HealthResponseSchema.safeParse(data);

    if (parsed.success && parsed.data.status === "ok") {
      const successStatus: AgentStatus = {
        connected: true,
        version: parsed.data.version,
        lastChecked: new Date().toISOString(),
      };
      await setAgentStatus(successStatus);
      return successStatus;
    } else {
      const errorStatus: AgentStatus = {
        connected: false,
        lastChecked: new Date().toISOString(),
        error: "Invalid health response format",
      };
      await setAgentStatus(errorStatus);
      return errorStatus;
    }
  } catch (err: any) {
    const errorStatus: AgentStatus = {
      connected: false,
      lastChecked: new Date().toISOString(),
      error: err.name === "AbortError" ? "Connection timed out" : (err.message || "Failed to connect to agent"),
    };
    await setAgentStatus(errorStatus);
    return errorStatus;
  }
}

export async function forwardSubmissionToAgent(payload: any): Promise<any> {
  const config = await getConfig();

  if (!config.autoSync) {
    console.log("[CodeSync Service Worker] Auto-sync is disabled in settings. Skipping submission.");
    return { status: "skipped", reason: "auto_sync_disabled" };
  }

  const platform = payload.platform as "leetcode" | "gfg";
  if (config.platforms && config.platforms[platform] === false) {
    console.log(`[CodeSync Service Worker] Platform '${platform}' is disabled in settings. Skipping submission.`);
    return { status: "skipped", reason: "platform_disabled" };
  }

  const url = `${config.agentUrl.replace(/\/+$/, "")}/api/v1/submissions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.bearerToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[CodeSync Service Worker] Agent submission error:", response.status, errorData);
      return { status: "error", code: response.status, details: errorData };
    }

    const data = await response.json();
    const parsed = SubmissionResponseSchema.safeParse(data);

    if (parsed.success) {
      // Record last sync activity in storage
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          lastSync: {
            title: payload.problem.title,
            slug: payload.problem.slug,
            platform: payload.platform,
            difficulty: payload.problem.difficulty,
            timestamp: new Date().toISOString(),
            jobId: parsed.data.jobId,
            status: parsed.data.status,
          },
        });
      }
      return parsed.data;
    }

    return data;
  } catch (err: any) {
    console.error("[CodeSync Service Worker] Network error forwarding submission:", err);
    return { status: "error", message: err.message || "Network error reaching agent" };
  }
}

// Service worker listeners
if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(() => {
    console.log("[CodeSync Background] Extension installed/updated. Running initial agent health check...");
    checkAgentConnection();

    if (chrome.alarms) {
      chrome.alarms.create("checkAgentHealth", { periodInMinutes: 1 });
    }
  });

  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "checkAgentHealth") {
        checkAgentConnection();
      }
    });
  }

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "GET_AGENT_STATUS") {
      getAgentStatus().then(sendResponse);
      return true;
    }

    if (message.type === "CHECK_AGENT_CONNECTION") {
      checkAgentConnection().then(sendResponse);
      return true;
    }

    if (message.type === "GET_CONFIG") {
      getConfig().then(sendResponse);
      return true;
    }

    if (message.type === "SET_CONFIG") {
      setConfig(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "SUBMIT_SOLUTION") {
      forwardSubmissionToAgent(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "SUBMIT_BULK_SOLUTIONS") {
      (async () => {
        try {
          const config = await getConfig();
          const url = `${config.agentUrl.replace(/\/+$/, "")}/api/v1/submissions/bulk`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.bearerToken}`,
            },
            body: JSON.stringify(message.payload),
          });
          const data = await res.json();
          sendResponse(data);
        } catch (err: any) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });
}

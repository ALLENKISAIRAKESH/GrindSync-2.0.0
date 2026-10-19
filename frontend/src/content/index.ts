import { PlatformAdapter, SolutionSubmission } from "@codesync/shared";
import { LeetCodeAdapter } from "./leetcode/leetcode-adapter.js";
import { GFGAdapter } from "./gfg/gfg-adapter.js";

const adapters: PlatformAdapter[] = [new LeetCodeAdapter(), new GFGAdapter()];

function findActiveAdapter(): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.detect());
}

let lastSyncedKey = "";
let isProcessing = false;
let currentUrl = typeof window !== "undefined" ? window.location.href : "";

async function checkAndSync(adapter: PlatformAdapter) {
  if (isProcessing) return;

  try {
    const status = await adapter.getSubmissionStatus();
    if (status !== "accepted") {
      return;
    }

    const submissionData = await adapter.getSubmission();
    if (!submissionData.code || submissionData.code.trim().length === 0) {
      console.log("[GrindSync] Accepted status detected, but code editor buffer is empty.");
      return;
    }

    const problemMetadata = await adapter.getProblem();
    const syncKey = `${problemMetadata.slug}:${submissionData.code.trim()}`;

    // Prevent duplicate capture in current session
    if (syncKey === lastSyncedKey) {
      return;
    }

    isProcessing = true;

    // Watchdog timer: ensure isProcessing never gets permanently stuck
    const watchdogTimer = setTimeout(() => {
      isProcessing = false;
    }, 15000);

    const payload: SolutionSubmission = {
      platform: adapter.name,
      problem: problemMetadata,
      submission: submissionData,
    };

    console.log("[GrindSync] Captured accepted solution! Dispatching to agent:", payload.problem.title);

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: "SUBMIT_SOLUTION",
          payload,
        },
        (response) => {
          clearTimeout(watchdogTimer);
          if (chrome.runtime.lastError) {
            console.error("[GrindSync] Failed to send submission to background:", chrome.runtime.lastError.message);
          } else {
            console.log("[GrindSync] Agent response:", response);
            lastSyncedKey = syncKey;
          }
          isProcessing = false;
        }
      );
    } else {
      clearTimeout(watchdogTimer);
      isProcessing = false;
    }
  } catch (err) {
    console.error("[GrindSync] Error during submission extraction:", err);
    isProcessing = false;
  }
}

function initContentScript() {
  const adapter = findActiveAdapter();
  if (!adapter) {
    return;
  }

  console.log(`[GrindSync] Initialized adapter for platform: ${adapter.name}`);

  // Set up debounced DOM observer
  let debounceTimeout: any = null;
  const observer = new MutationObserver(() => {
    // Detect SPA URL navigation (e.g., clicking to next problem in LeetCode)
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      isProcessing = false;
    }

    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      checkAndSync(adapter);
    }, 600);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Watch SPA navigation events
  window.addEventListener("popstate", () => {
    currentUrl = window.location.href;
    isProcessing = false;
    checkAndSync(adapter);
  });

  // Initial check on load
  checkAndSync(adapter);
}

// Always register manual sync listener across all matching platform pages
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "MANUAL_SYNC") {
      const adapter = findActiveAdapter();
      if (!adapter) {
        sendResponse({
          success: false,
          isProblemPage: false,
          message: "Please open a problem on practice.geeksforgeeks.org to capture your solution.",
        });
        return true;
      }

      (async () => {
        try {
          const submissionData = await adapter.getSubmission();
          const problemMetadata = await adapter.getProblem();
          if (!submissionData.code || submissionData.code.trim().length === 0) {
            sendResponse({
              success: false,
              isProblemPage: true,
              message: `No code found in editor for "${problemMetadata.title}". Please write or load your code in the editor.`,
            });
            return;
          }

          const payload: SolutionSubmission = {
            platform: adapter.name,
            problem: problemMetadata,
            submission: {
              ...submissionData,
              status: "accepted",
            },
          };

          chrome.runtime.sendMessage({ type: "SUBMIT_SOLUTION", payload }, (resp) => {
            sendResponse({
              success: true,
              isProblemPage: true,
              title: problemMetadata.title,
              response: resp,
            });
          });
        } catch (err: any) {
          sendResponse({ success: false, message: err.message || "Capture failed" });
        }
      })();
      return true;
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initContentScript);
  } else {
    initContentScript();
  }
}

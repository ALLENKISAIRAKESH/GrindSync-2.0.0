import { AgentStatus, ExtensionConfig } from "@codesync/shared";
import { getConfig, setConfig, getAgentStatus } from "../storage/config.js";
import {
  fetchLeetCodeHistory,
  sendBulkSubmissionsToAgent,
  fetchPlatformStats,
  PlatformSyncStats,
} from "../services/history-sync.js";

// Views
const viewMain = document.getElementById("view-main") as HTMLElement;
const viewSettings = document.getElementById("view-settings") as HTMLElement;
const viewHistory = document.getElementById("view-history") as HTMLElement;

// Header & Agent Connection DOM Elements
const agentBadge = document.getElementById("agent-badge") as HTMLElement;
const agentStatusText = document.getElementById("agent-status-text") as HTMLElement;
const agentDetailsStatus = document.getElementById("agent-details-status") as HTMLElement;
const agentEndpoint = document.getElementById("agent-endpoint") as HTMLElement;
const btnRefresh = document.getElementById("btn-refresh") as HTMLButtonElement;

// Main View Toggles & Activity
const toggleAutoSync = document.getElementById("toggle-auto-sync") as HTMLInputElement;
const toggleAi = document.getElementById("toggle-ai") as HTMLInputElement;
const toggleAutoPush = document.getElementById("toggle-auto-push") as HTMLInputElement;
const activityTimestamp = document.getElementById("activity-timestamp") as HTMLElement;
const activityBody = document.getElementById("activity-body") as HTMLElement;

// Footer & Navigation Buttons
const btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
const btnHistory = document.getElementById("btn-history") as HTMLButtonElement;
const btnSettingsBack = document.getElementById("btn-settings-back") as HTMLButtonElement;
const btnHistoryBack = document.getElementById("btn-history-back") as HTMLButtonElement;

// Platform Sync Tracker Elements
const tabPlatformLeetcode = document.getElementById("tab-platform-leetcode") as HTMLButtonElement | null;
const tabPlatformGfg = document.getElementById("tab-platform-gfg") as HTMLButtonElement | null;
const statTotalSolved = document.getElementById("stat-total-solved") as HTMLElement | null;
const statAlreadyPushed = document.getElementById("stat-already-pushed") as HTMLElement | null;
const statNeedToPush = document.getElementById("stat-need-to-push") as HTMLElement | null;
const btnSyncAll = document.getElementById("btn-sync-all") as HTMLButtonElement | null;
const syncAllStatus = document.getElementById("sync-all-status") as HTMLElement | null;
const tabContextBanner = document.getElementById("tab-context-banner") as HTMLElement | null;
const tabContextText = document.getElementById("tab-context-text") as HTMLElement | null;
const tabContextBadge = document.getElementById("tab-context-badge") as HTMLElement | null;

// Settings Form Elements
const inputGithubProfile = document.getElementById("input-github-profile") as HTMLInputElement;
const btnAutoLink = document.getElementById("btn-auto-link") as HTMLButtonElement;
const inputGithubToken = document.getElementById("input-github-token") as HTMLInputElement;
const btnCreateRemote = document.getElementById("btn-create-remote") as HTMLButtonElement;
const inputLeetcodeUsername = document.getElementById("input-leetcode-username") as HTMLInputElement;
const inputGfgUsername = document.getElementById("input-gfg-username") as HTMLInputElement;
const inputAgentUrl = document.getElementById("input-agent-url") as HTMLInputElement;
const inputBearerToken = document.getElementById("input-bearer-token") as HTMLInputElement;
const inputRepoPath = document.getElementById("input-repo-path") as HTMLInputElement;
const inputCommitFormat = document.getElementById("input-commit-format") as HTMLInputElement;
const toggleLeetcode = document.getElementById("toggle-leetcode") as HTMLInputElement;
const toggleGfg = document.getElementById("toggle-gfg") as HTMLInputElement;
const btnSettingsSave = document.getElementById("btn-settings-save") as HTMLButtonElement;
const settingsSaveStatus = document.getElementById("settings-save-status") as HTMLElement;

// History Container
const historyBody = document.getElementById("history-body") as HTMLElement;

function showView(view: "main" | "settings" | "history") {
  viewMain.classList.toggle("hidden", view !== "main");
  viewSettings.classList.toggle("hidden", view !== "settings");
  viewHistory.classList.toggle("hidden", view !== "history");
}

function updateAgentUI(status: AgentStatus, config: ExtensionConfig) {
  if (config.agentUrl) {
    try {
      const url = new URL(config.agentUrl);
      agentEndpoint.textContent = url.host;
    } catch {
      agentEndpoint.textContent = config.agentUrl;
    }
  }

  if (status.connected) {
    agentBadge.className = "badge badge-connected";
    agentStatusText.textContent = "Agent Connected";
    agentDetailsStatus.className = "status-val connected";
    agentDetailsStatus.textContent = `Connected (${status.version || "v0.1.0"})`;
  } else {
    agentBadge.className = "badge badge-disconnected";
    agentStatusText.textContent = "Disconnected";
    agentDetailsStatus.className = "status-val disconnected";
    agentDetailsStatus.textContent = status.error || "Disconnected";
  }
}

async function renderActivity() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get("lastSync");
    const lastSync = data?.lastSync;

    if (lastSync && lastSync.title) {
      const date = new Date(lastSync.timestamp);
      const timeStr = isNaN(date.getTime()) ? "Recently" : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      activityTimestamp.textContent = timeStr;

      const diffClass = (lastSync.difficulty || "").toLowerCase();
      activityBody.innerHTML = `
        <div class="activity-item">
          <div class="activity-title">
            <span>${escapeHtml(lastSync.title)}</span>
            <span class="activity-badge ${diffClass}">${escapeHtml(lastSync.difficulty || "Solved")}</span>
          </div>
          <div class="activity-meta">
            <span class="activity-badge platform">${escapeHtml(lastSync.platform || "DSA")}</span>
            <span>Status: ${escapeHtml(lastSync.status || "synced")}</span>
          </div>
        </div>
      `;

      // Also render into history view
      historyBody.innerHTML = `
        <div class="activity-item">
          <div class="activity-title">
            <span>${escapeHtml(lastSync.title)}</span>
            <span class="activity-badge ${diffClass}">${escapeHtml(lastSync.difficulty || "Solved")}</span>
          </div>
          <div class="activity-meta">
            <span class="activity-badge platform">${escapeHtml(lastSync.platform || "DSA")}</span>
            <span>Job: ${escapeHtml(lastSync.jobId || "N/A")}</span>
            <span>${escapeHtml(new Date(lastSync.timestamp).toLocaleString())}</span>
          </div>
        </div>
      `;
      return;
    }
  }

  activityBody.innerHTML = `<p class="empty-state">No submissions synchronized yet. Solve a problem on LeetCode or GeeksforGeeks to get started!</p>`;
  historyBody.innerHTML = `<p class="empty-state">No history yet. Your synced submissions will appear here.</p>`;
}

async function refreshConnection() {
  btnRefresh.classList.add("spinning");
  agentStatusText.textContent = "Checking...";

  try {
    let status: AgentStatus;
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      status = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "CHECK_AGENT_CONNECTION" }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve({
              connected: false,
              lastChecked: new Date().toISOString(),
              error: "Background service worker not responding",
            });
          } else {
            resolve(response);
          }
        });
      });
    } else {
      // Direct fallback for testing
      const config = await getConfig();
      try {
        const res = await fetch(`${config.agentUrl}/health`);
        const json = await res.json();
        status = {
          connected: json.status === "ok",
          version: json.version,
          lastChecked: new Date().toISOString(),
        };
      } catch (e: any) {
        status = {
          connected: false,
          lastChecked: new Date().toISOString(),
          error: e.message || "Failed to reach agent",
        };
      }
    }

    const config = await getConfig();
    updateAgentUI(status, config);
  } finally {
    btnRefresh.classList.remove("spinning");
  }
}

function populateSettingsForm(config: ExtensionConfig) {
  inputAgentUrl.value = config.agentUrl || "http://127.0.0.1:4578";
  inputBearerToken.value = config.bearerToken || "GrindSync-local-dev-token";
  inputRepoPath.value = config.repoPath || "";
  inputCommitFormat.value = config.commitFormat || "feat({platform}): add {problem}";
  if (inputLeetcodeUsername) inputLeetcodeUsername.value = config.leetcodeUsername || "";
  if (inputGfgUsername) inputGfgUsername.value = config.gfgUsername || "";
  toggleLeetcode.checked = config.platforms?.leetcode ?? true;
  toggleGfg.checked = config.platforms?.gfg ?? true;
}

async function saveSettings() {
  btnSettingsSave.textContent = "Saving...";
  settingsSaveStatus.className = "save-status";
  settingsSaveStatus.textContent = "";

  try {
    const updated = await setConfig({
      agentUrl: inputAgentUrl.value.trim(),
      bearerToken: inputBearerToken.value.trim(),
      repoPath: inputRepoPath.value.trim(),
      commitFormat: inputCommitFormat.value.trim(),
      leetcodeUsername: inputLeetcodeUsername?.value?.trim() || undefined,
      gfgUsername: inputGfgUsername?.value?.trim() || undefined,
      platforms: {
        leetcode: toggleLeetcode.checked,
        gfg: toggleGfg.checked,
      },
    });

    const status = await getAgentStatus();
    updateAgentUI(status, updated);

    settingsSaveStatus.className = "save-status success";
    settingsSaveStatus.textContent = "✓ Settings saved successfully!";
    setTimeout(() => {
      settingsSaveStatus.textContent = "";
    }, 2500);
  } catch (err: any) {
    settingsSaveStatus.className = "save-status error";
    settingsSaveStatus.textContent = `Error: ${err.message || "Failed to save"}`;
  } finally {
    btnSettingsSave.textContent = "Save Settings";
  }
}

let currentPlatform: "leetcode" | "gfg" = "leetcode";
let cachedStats: PlatformSyncStats | null = null;

interface ActiveTabInfo {
  platform?: "leetcode" | "gfg";
  problemTitle?: string;
  url?: string;
}

let activeTabContext: ActiveTabInfo = {};

async function detectActiveTab(): Promise<ActiveTabInfo> {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) {
    return {};
  }
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url) {
          resolve({});
          return;
        }

        const url = tab.url;
        let platform: "leetcode" | "gfg" | undefined;
        let problemTitle: string | undefined;

        if (url.includes("geeksforgeeks.org")) {
          platform = "gfg";
          if (
            url.includes("/problems/") ||
            url.includes("/batch/") ||
            url.includes("/contest/") ||
            (url.includes("/track/") && url.includes("/problem/"))
          ) {
            const raw = tab.title || "";
            let cleaned = raw
              .replace(/\|.*$/i, "")
              .replace(/- GeeksforGeeks.*$/i, "")
              .replace(/Practice.*$/i, "")
              .trim();
            if (!cleaned || cleaned.toLowerCase() === "practice") {
              const slugMatch = url.match(/\/problems\/([^/?#]+)/i) || url.match(/\/problem\/([^/?#]+)/i);
              cleaned = slugMatch ? slugMatch[1].replace(/-/g, " ") : "GFG Problem";
            }
            problemTitle = cleaned;
          }
        } else if (url.includes("leetcode.com") || url.includes("leetcode.cn")) {
          platform = "leetcode";
          if (url.includes("/problems/")) {
            const raw = tab.title || "";
            problemTitle = raw.replace(/- LeetCode.*$/i, "").trim();
          }
        }

        resolve({ platform, problemTitle, url });
      });
    } catch {
      resolve({});
    }
  });
}

function updateContextBanner(platform: "leetcode" | "gfg") {
  if (!tabContextText || !tabContextBadge) return;

  const isCurrentPlatformActive = activeTabContext.platform === platform;

  if (isCurrentPlatformActive && activeTabContext.problemTitle) {
    tabContextText.textContent = `${activeTabContext.problemTitle}`;
    tabContextBadge.textContent = "● On Problem";
    tabContextBadge.style.background = "rgba(34, 197, 94, 0.15)";
    tabContextBadge.style.color = "#4ade80";
    tabContextBadge.style.borderColor = "rgba(34, 197, 94, 0.3)";
  } else if (isCurrentPlatformActive) {
    tabContextText.textContent = `${platform === "leetcode" ? "LeetCode" : "GeeksforGeeks"} (Active Tab)`;
    tabContextBadge.textContent = "● Live";
    tabContextBadge.style.background = "rgba(34, 197, 94, 0.15)";
    tabContextBadge.style.color = "#4ade80";
    tabContextBadge.style.borderColor = "rgba(34, 197, 94, 0.3)";
  } else {
    tabContextText.textContent = `${platform === "leetcode" ? "LeetCode" : "GeeksforGeeks"} Sync`;
    tabContextBadge.textContent = "○ Standby";
    tabContextBadge.style.background = "rgba(255, 255, 255, 0.05)";
    tabContextBadge.style.color = "var(--color-text-secondary)";
    tabContextBadge.style.borderColor = "rgba(255, 255, 255, 0.1)";
  }
}

async function refreshPlatformStats() {
  if (statTotalSolved) statTotalSolved.textContent = "...";
  if (statAlreadyPushed) statAlreadyPushed.textContent = "...";
  if (statNeedToPush) statNeedToPush.textContent = "...";

  try {
    const config = await getConfig();
    const user = currentPlatform === "leetcode" ? config.leetcodeUsername : config.gfgUsername;
    const stats = await fetchPlatformStats(currentPlatform, user);
    cachedStats = stats;

    if (statTotalSolved) statTotalSolved.textContent = String(stats.totalSolved);
    if (statAlreadyPushed) statAlreadyPushed.textContent = String(stats.alreadyPushed);
    if (statNeedToPush) statNeedToPush.textContent = String(stats.needToPush);

    updateContextBanner(currentPlatform);

    if (syncAllStatus && btnSyncAll) {
      if (currentPlatform === "leetcode") {
        const platformName = "LeetCode";
        if (stats.needToPush > 0) {
          btnSyncAll.disabled = false;
          btnSyncAll.innerHTML = `<span>🔄 Sync ${stats.needToPush} Pending Solutions</span>`;
          syncAllStatus.className = "save-status";
          syncAllStatus.textContent = `${stats.needToPush} accepted ${platformName} solutions ready to push (${stats.alreadyPushed} already in Git).`;
        } else if (stats.totalSolved > 0) {
          btnSyncAll.disabled = true;
          btnSyncAll.innerHTML = `<span>✓ All ${stats.totalSolved} Solutions Synced</span>`;
          syncAllStatus.className = "save-status success";
          syncAllStatus.textContent = `All ${stats.totalSolved} solved ${platformName} problems are already pushed to GitHub! Zero duplicates.`;
        } else {
          btnSyncAll.disabled = false;
          btnSyncAll.innerHTML = `<span>🔄 Sync Solved Problems</span>`;
          syncAllStatus.className = "save-status";
          syncAllStatus.textContent = `Log into ${platformName} to track and push your solutions.`;
        }
      } else {
        // GeeksforGeeks
        btnSyncAll.disabled = false;
        if (activeTabContext.platform === "gfg" && activeTabContext.problemTitle) {
          btnSyncAll.innerHTML = `<span>⚡ Push "${activeTabContext.problemTitle.slice(0, 24)}" to GitHub</span>`;
          syncAllStatus.className = "save-status";
          syncAllStatus.textContent = `Ready to push this solution to GitHub (${stats.alreadyPushed} of ${stats.totalSolved} GFG problems in Git).`;
        } else {
          btnSyncAll.innerHTML = `<span>⚡ Push Solution to GitHub</span>`;
          syncAllStatus.className = "save-status";
          syncAllStatus.textContent = `Open any solved problem on GFG, and GrindSync auto-pushes it to Git (${stats.alreadyPushed} of ${stats.totalSolved} in Git).`;
        }
      }
    }
  } catch (err) {
    console.warn("[GrindSync] Stats refresh error:", err);
    if (statTotalSolved) statTotalSolved.textContent = "0";
    if (statAlreadyPushed) statAlreadyPushed.textContent = "0";
    if (statNeedToPush) statNeedToPush.textContent = "0";
  }
}

function setPlatform(platform: "leetcode" | "gfg", tabInfo?: ActiveTabInfo) {
  currentPlatform = platform;
  if (tabInfo) {
    activeTabContext = tabInfo;
  }

  if (tabPlatformLeetcode && tabPlatformGfg) {
    if (platform === "leetcode") {
      tabPlatformLeetcode.style.background = "#6366f1";
      tabPlatformLeetcode.style.borderColor = "#6366f1";
      tabPlatformLeetcode.style.color = "white";
      tabPlatformGfg.style.background = "transparent";
      tabPlatformGfg.style.borderColor = "rgba(255, 255, 255, 0.15)";
      tabPlatformGfg.style.color = "var(--color-text-secondary)";
    } else {
      tabPlatformGfg.style.background = "#6366f1";
      tabPlatformGfg.style.borderColor = "#6366f1";
      tabPlatformGfg.style.color = "white";
      tabPlatformLeetcode.style.background = "transparent";
      tabPlatformLeetcode.style.borderColor = "rgba(255, 255, 255, 0.15)";
      tabPlatformLeetcode.style.color = "var(--color-text-secondary)";
    }
  }

  updateContextBanner(platform);
  refreshPlatformStats();
}

async function handleSyncAll() {
  if (!btnSyncAll || !syncAllStatus) return;

  if (currentPlatform === "gfg") {
    btnSyncAll.disabled = true;
    btnSyncAll.innerHTML = "<span>⏳ Capturing GFG solution...</span>";
    syncAllStatus.className = "save-status";
    syncAllStatus.textContent = "Scanning for problem and solution code...";

    const searchOtherTabs = () => {
      chrome.tabs.query({ url: "*://*.geeksforgeeks.org/*" }, (allGfgTabs) => {
        if (!allGfgTabs || allGfgTabs.length === 0) {
          btnSyncAll!.disabled = false;
          syncAllStatus!.className = "save-status";
          syncAllStatus!.textContent = "⚡ Open any solved problem on GeeksforGeeks, and click Push to sync to GitHub!";
          return;
        }

        let checked = 0;
        let found = false;
        const total = allGfgTabs.length;

        const finalizeNoCodeFound = () => {
          btnSyncAll!.disabled = false;
          syncAllStatus!.className = "save-status";
          syncAllStatus!.textContent =
            "⚡ Please open any solved problem on GeeksforGeeks with your code in the editor, then click Push (or submit) to sync to GitHub!";
        };

        for (const tab of allGfgTabs) {
          if (!tab.id) {
            checked++;
            if (checked === total && !found) finalizeNoCodeFound();
            continue;
          }

          chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SYNC" }, (resp) => {
            checked++;
            if (!found && !chrome.runtime.lastError && resp?.success) {
              found = true;
              btnSyncAll!.disabled = false;
              syncAllStatus!.className = "save-status success";
              syncAllStatus!.textContent = `✓ Successfully captured "${resp.title}" from open tab and pushed to GitHub!`;
              refreshPlatformStats();
              renderActivity();
              return;
            }

            if (checked === total && !found) {
              finalizeNoCodeFound();
            }
          });
        }
      });
    };

    // 1. Try active tab first
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, { type: "MANUAL_SYNC" }, (response) => {
          if (!chrome.runtime.lastError && response?.success) {
            btnSyncAll!.disabled = false;
            syncAllStatus!.className = "save-status success";
            syncAllStatus!.textContent = `✓ Successfully captured "${response.title}" and pushed to GitHub!`;
            refreshPlatformStats();
            renderActivity();
            return;
          }

          // Active tab didn't have code or failed — search other open tabs
          searchOtherTabs();
        });
      } else {
        searchOtherTabs();
      }
    });
    return;
  }

  // LeetCode Sync
  btnSyncAll.disabled = true;
  btnSyncAll.innerHTML = "<span>⏳ Syncing in progress...</span>";
  syncAllStatus.className = "save-status";
  syncAllStatus.textContent = "Connecting to LeetCode session...";

  try {
    const config = await getConfig();
    const leetcodeUser = config.leetcodeUsername || inputLeetcodeUsername?.value?.trim() || "";
    const alreadySynced = cachedStats?.syncedSlugs || [];
    const pendingSlugs = cachedStats?.solvedSlugs || [];

    if (cachedStats && cachedStats.needToPush === 0 && cachedStats.totalSolved > 0) {
      syncAllStatus.className = "save-status success";
      syncAllStatus.textContent = `All ${cachedStats.totalSolved} LeetCode problems are already pushed to GitHub!`;
      btnSyncAll.disabled = false;
      return;
    }

    syncAllStatus.textContent = "Fetching unpushed LeetCode solutions via GraphQL...";
    const submissions = await fetchLeetCodeHistory(
      leetcodeUser,
      alreadySynced,
      pendingSlugs,
      (msg) => {
        if (syncAllStatus) syncAllStatus.textContent = msg;
      }
    );

    if (submissions.length === 0) {
      if (cachedStats && cachedStats.needToPush > 0) {
        syncAllStatus.className = "save-status error";
        syncAllStatus.textContent = `⚠️ Could not retrieve code for ${cachedStats.needToPush} pending problems. Please log into leetcode.com in Chrome.`;
      } else {
        syncAllStatus.className = "save-status success";
        syncAllStatus.textContent = "All solved problems are already pushed to GitHub! Zero duplicates.";
      }
      await refreshPlatformStats();
      return;
    }

    syncAllStatus.textContent = `Found ${submissions.length} new solutions. Pushing to GitHub repository...`;
    const result = await sendBulkSubmissionsToAgent(
      submissions,
      (msg) => {
        if (syncAllStatus) syncAllStatus.textContent = msg;
      }
    );

    syncAllStatus.className = "save-status success";
    syncAllStatus.textContent = `✓ Successfully pushed ${result.syncedCount} new solutions (${result.duplicateCount} duplicates avoided)!`;
    await refreshPlatformStats();
    await renderActivity();
  } catch (err: any) {
    syncAllStatus.className = "save-status error";
    syncAllStatus.textContent = `Sync failed: ${err.message || "Failed to sync submissions"}`;
  } finally {
    btnSyncAll.disabled = false;
    await refreshPlatformStats();
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function performRepoSetup(withToken: boolean) {
  const profileUrl = inputGithubProfile.value.trim();
  const githubToken = inputGithubToken.value.trim();

  if (!profileUrl && !githubToken) {
    settingsSaveStatus.className = "save-status error";
    settingsSaveStatus.textContent = "Please enter your GitHub profile URL or GitHub Token";
    return;
  }

  const activeBtn = withToken ? btnCreateRemote : btnAutoLink;
  activeBtn.textContent = withToken ? "Creating on GitHub..." : "Linking...";
  settingsSaveStatus.className = "save-status";
  settingsSaveStatus.textContent = "";

  try {
    const config = await getConfig();
    const token = config.bearerToken || "GrindSync-local-dev-token";
    const agentUrl = config.agentUrl || "http://127.0.0.1:4578";

    const res = await fetch(`${agentUrl}/api/v1/setup-github-repo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        profileUrl: profileUrl || undefined,
        githubToken: githubToken || undefined,
        repoName: "My-Solved-Problems_GrindSync",
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to auto-setup repository");
    }

    inputRepoPath.value = data.repoPath;
    await setConfig({
      repoPath: data.repoPath,
      autoPush: true,
    });
    toggleAutoPush.checked = true;

    if (!withToken && !data.remoteCreated) {
      // Option 1 path: local folder ready but user must create the repo on GitHub.
      // Open github.com/new with name + description pre-filled — user just clicks "Create repository".
      const repoName = "My-Solved-Problems_GrindSync";
      const githubNewUrl =
        `https://github.com/new?name=${encodeURIComponent(repoName)}` +
        `&description=${encodeURIComponent("⚡ Automatically synchronized LeetCode & GeeksForGeeks DSA solutions with diagrammatic explanations")}` +
        `&visibility=public`;
      chrome.tabs.create({ url: githubNewUrl });

      settingsSaveStatus.className = "save-status success";
      settingsSaveStatus.textContent =
        `✓ Local folder ready! GitHub opened — just click "Create repository" there (name is pre-filled), then come back.`;
    } else {
      settingsSaveStatus.className = "save-status success";
      settingsSaveStatus.textContent = `✓ ${data.message}`;
    }
  } catch (err: any) {
    settingsSaveStatus.className = "save-status error";
    settingsSaveStatus.textContent = `Setup error: ${err.message}`;
  } finally {
    btnAutoLink.textContent = "⚡ Auto-Link";
    btnCreateRemote.textContent = "🚀 Create on GitHub";
  }
}

async function handleAutoLink() {
  await performRepoSetup(false);
}

async function handleCreateRemote() {
  await performRepoSetup(true);
}

async function init() {
  const config = await getConfig();
  const status = await getAgentStatus();

  // Populate main toggles
  toggleAutoSync.checked = config.autoSync;
  toggleAi.checked = config.aiExplanation;
  toggleAutoPush.checked = config.autoPush;

  updateAgentUI(status, config);
  await renderActivity();

  // Populate settings form
  populateSettingsForm(config);

  // Main toggle change handlers
  toggleAutoSync.addEventListener("change", async () => {
    await setConfig({ autoSync: toggleAutoSync.checked });
  });

  toggleAi.addEventListener("change", async () => {
    await setConfig({ aiExplanation: toggleAi.checked });
  });

  toggleAutoPush.addEventListener("change", async () => {
    await setConfig({ autoPush: toggleAutoPush.checked });
  });

  // Navigation handlers
  btnSettings.addEventListener("click", () => {
    getConfig().then(populateSettingsForm);
    showView("settings");
  });

  btnHistory.addEventListener("click", () => {
    renderActivity();
    showView("history");
  });

  btnSettingsBack.addEventListener("click", () => showView("main"));
  btnHistoryBack.addEventListener("click", () => showView("main"));

  // Settings save handler
  btnSettingsSave.addEventListener("click", saveSettings);

  // Auto-link and Create-on-GitHub button handlers
  if (btnAutoLink) {
    btnAutoLink.addEventListener("click", handleAutoLink);
  }
  if (btnCreateRemote) {
    btnCreateRemote.addEventListener("click", handleCreateRemote);
  }

  // Platform tabs handlers
  if (tabPlatformLeetcode) {
    tabPlatformLeetcode.addEventListener("click", () => setPlatform("leetcode"));
  }
  if (tabPlatformGfg) {
    tabPlatformGfg.addEventListener("click", () => setPlatform("gfg"));
  }

  // Sync all solved problems handler
  if (btnSyncAll) {
    btnSyncAll.addEventListener("click", handleSyncAll);
  }

  // Live refresh button
  btnRefresh.addEventListener("click", async () => {
    refreshConnection();
    const tabInfo = await detectActiveTab();
    setPlatform(currentPlatform, tabInfo);
  });

  // Trigger live check and detect active tab on popup open
  refreshConnection();
  const tabInfo = await detectActiveTab();
  if (tabInfo.platform) {
    setPlatform(tabInfo.platform, tabInfo);
  } else {
    setPlatform("leetcode", tabInfo);
  }
}

document.addEventListener("DOMContentLoaded", init);

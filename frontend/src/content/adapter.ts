import { PlatformAdapter, SolutionSubmission, SubmissionStatus } from "@codesync/shared";

export type { PlatformAdapter, SolutionSubmission, SubmissionStatus };

/**
 * Requests the current editor code from the MAIN world bridge (monaco-bridge.ts).
 * Uses postMessage instead of <script> injection to comply with CSP in MV3.
 * Timeout: 2000ms — falls back to empty string.
 */
export function requestMainWorldCode(timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    const id = `codesync-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== "CODESYNC_CODE_RESPONSE") return;
      if (event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      resolve(event.data.code || "");
    };

    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve("");
    }, timeoutMs);

    window.addEventListener("message", handler);
    window.postMessage({ type: "CODESYNC_GET_CODE", id }, "*");
  });
}


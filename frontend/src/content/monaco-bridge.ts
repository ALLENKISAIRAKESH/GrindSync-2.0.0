/**
 * Monaco / ACE Code Bridge — runs in the MAIN world (page context).
 *
 * Listens for postMessage requests from the isolated content script,
 * reads Monaco/ACE editor code directly, and posts back the result.
 * This avoids inline <script> injection that violates CSP in MV3.
 */

window.addEventListener("message", (event) => {
  // Only handle requests from the same window
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "CODESYNC_GET_CODE") return;

  const { id } = event.data;
  let code = "";

  try {
    const win = window as any;

    // 1. Try Monaco editor (LeetCode, modern GFG)
    if (win.monaco && win.monaco.editor) {
      // Priority A: Try active/focused editor instance
      const editors = typeof win.monaco.editor.getEditors === "function" ? win.monaco.editor.getEditors() : [];
      for (const ed of editors) {
        if (typeof ed.getModel === "function") {
          const model = ed.getModel();
          if (model) {
            const uri = model.uri ? model.uri.toString() : "";
            // Filter out output, console, diff models
            if (!uri.includes("output") && !uri.includes("console")) {
              const val = model.getValue();
              if (val && val.trim().length > 0) {
                code = val;
                break;
              }
            }
          }
        }
      }

      // Priority B: Fallback across all models (excluding internal/typings models)
      if (!code && typeof win.monaco.editor.getModels === "function") {
        const models = win.monaco.editor.getModels();
        if (models && models.length > 0) {
          for (const model of models) {
            const uri = model.uri ? model.uri.toString() : "";
            if (uri.endsWith(".d.ts") || uri.includes("node_modules")) continue;
            const val = model.getValue();
            if (val && val.length > code.length) {
              code = val;
            }
          }
        }
      }
    }

    // 2. Try ACE editor (older GFG)
    if (!code && win.ace) {
      try {
        const aceEl = document.querySelector(".ace_editor");
        if (aceEl) {
          const editor = win.ace.edit(aceEl);
          if (editor) {
            code = editor.getValue() || "";
          }
        }
      } catch (_) {
        // ACE not available
      }
    }

    // 3. Try CodeMirror 6 (newer implementations)
    if (!code && win.CodeMirror) {
      try {
        const cmEl = document.querySelector(".cm-editor");
        if (cmEl && (cmEl as any).CodeMirror) {
          code = (cmEl as any).CodeMirror.state.doc.toString() || "";
        }
      } catch (_) {
        // CM6 not available
      }
    }
  } catch (err) {
    code = "";
  }

  window.postMessage(
    { type: "CODESYNC_CODE_RESPONSE", id, code },
    "*"
  );
});

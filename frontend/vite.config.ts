import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/popup.html"),
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/index.ts"),
        "monaco-bridge": resolve(__dirname, "src/content/monaco-bridge.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "service-worker") {
            return "service-worker.js";
          }
          if (chunkInfo.name === "content") {
            return "content.js";
          }
          if (chunkInfo.name === "monaco-bridge") {
            return "monaco-bridge.js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  plugins: [
    {
      name: "copy-manifest",
      closeBundle() {
        const outDir = resolve(__dirname, "dist");
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }
        const manifestSrc = resolve(__dirname, "manifest.json");
        const manifestDist = resolve(__dirname, "dist/manifest.json");
        if (fs.existsSync(manifestSrc)) {
          fs.copyFileSync(manifestSrc, manifestDist);
        }
      },
    },
  ],
});

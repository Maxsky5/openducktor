import { createOpenDucktorStartupSplashPlugin } from "@openducktor/frontend/startup-splash/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import packageJson from "./package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendSrc = path.resolve(__dirname, "../frontend/src");
export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  const versionOverride = env.ODT_APP_VERSION?.trim();
  return versionOverride || packageJson.version;
}

export default defineConfig(({ mode }) => ({
  ...(mode === "standalone" && { cacheDir: "node_modules/.vite-client" }),
  plugins: [
    createOpenDucktorStartupSplashPlugin(),
    react(),
    tailwindcss(),
    ...(mode === "standalone" ? [clientHeaders()] : []),
  ],
  resolve: {
    dedupe: ["@tanstack/react-query", "react", "react-dom", "react-router"],
    alias: [
      { find: "@", replacement: frontendSrc },
      {
        find: "@openducktor/frontend/styles.css",
        replacement: path.join(frontendSrc, "styles.css"),
      },
      {
        find: /^@openducktor\/frontend\/lib\/(.*)$/,
        replacement: path.join(frontendSrc, "lib/$1"),
      },
      { find: "@openducktor/frontend", replacement: path.join(frontendSrc, "index.ts") },
    ],
  },
  define: {
    "import.meta.env.VITE_ODT_STANDALONE": JSON.stringify(mode === "standalone" ? "true" : "false"),
    "import.meta.env.VITE_ODT_APP_VERSION": JSON.stringify(resolveAppVersion()),
  },
  clearScreen: false,
  build: {
    reportCompressedSize: false,
  },
  server: {
    host: "127.0.0.1",
    port: mode === "standalone" ? 1421 : 1420,
    strictPort: true,
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
}));

/** Static hosts send the security headers in `_headers` of the standalone client output. */
const clientHeaders = (): Plugin => ({
  name: "openducktor-client-headers",
  apply: "build",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "_headers",
      source: readFileSync(path.join(__dirname, "client/_headers"), "utf8"),
    });
  },
});

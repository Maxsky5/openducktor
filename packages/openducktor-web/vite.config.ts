import { createOpenDucktorStartupSplashPlugin } from "@openducktor/frontend/startup-splash/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import packageJson from "./package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendSrc = path.resolve(__dirname, "../frontend/src");

export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  const versionOverride = env.ODT_APP_VERSION?.trim();
  return versionOverride || packageJson.version;
}

export default defineConfig({
  plugins: [createOpenDucktorStartupSplashPlugin(), react(), tailwindcss()],
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
    "import.meta.env.VITE_ODT_APP_VERSION": JSON.stringify(resolveAppVersion()),
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
});

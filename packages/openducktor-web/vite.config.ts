import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendSrc = path.resolve(__dirname, "../frontend/src");

function readPackageVersion(packageJsonPath = path.resolve(__dirname, "package.json")): string {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`Missing package version in ${packageJsonPath}`);
  }
  return packageJson.version;
}

export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.ODT_APP_VERSION ?? readPackageVersion();
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
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
  },
});

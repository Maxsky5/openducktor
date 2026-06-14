import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");
const packagesRoot = path.join(workspaceRoot, "packages");
const DEFAULT_RENDERER_DEV_PORT = 1430;

const readPackageVersion = (packageJsonPath = path.resolve(__dirname, "package.json")): string => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`Missing package version in ${packageJsonPath}`);
  }
  return packageJson.version;
};

export const resolveAppVersion = (env: NodeJS.ProcessEnv = process.env): string => {
  const versionOverride = env.ODT_APP_VERSION?.trim();
  return versionOverride || readPackageVersion();
};

const resolveRendererDevPort = (): number => {
  const configuredPort = process.env.ELECTRON_RENDERER_DEV_PORT?.trim();
  if (!configuredPort) {
    return DEFAULT_RENDERER_DEV_PORT;
  }

  if (!/^\d+$/.test(configuredPort)) {
    throw new Error(
      `ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: ${configuredPort}`,
    );
  }

  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: ${configuredPort}`,
    );
  }

  return port;
};

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_ODT_APP_VERSION": JSON.stringify(resolveAppVersion()),
  },
  resolve: {
    dedupe: ["@tanstack/react-query", "react", "react-dom", "react-router", "react-router-dom"],
    alias: [
      {
        find: "@openducktor/frontend/styles.css",
        replacement: path.join(packagesRoot, "frontend/src/styles.css"),
      },
      {
        find: /^@openducktor\/frontend\/lib\/(.*)$/,
        replacement: path.join(packagesRoot, "frontend/src/lib/$1"),
      },
      {
        find: "@openducktor/adapters-codex-app-server",
        replacement: path.join(packagesRoot, "adapters-codex-app-server/src/index.ts"),
      },
      {
        find: "@openducktor/adapters-opencode-sdk",
        replacement: path.join(packagesRoot, "adapters-opencode-sdk/src/index.ts"),
      },
      {
        find: "@openducktor/host-client",
        replacement: path.join(packagesRoot, "host-client/src/index.ts"),
      },
      {
        find: "@openducktor/contracts",
        replacement: path.join(packagesRoot, "contracts/src/index.ts"),
      },
      {
        find: "@openducktor/core",
        replacement: path.join(packagesRoot, "core/src/index.ts"),
      },
      {
        find: "@openducktor/frontend",
        replacement: path.join(packagesRoot, "frontend/src/index.ts"),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "../../packages/frontend/src"),
      },
    ],
  },
  build: {
    chunkSizeWarningLimit: 500,
  },
  clearScreen: false,
  server: {
    port: resolveRendererDevPort(),
    fs: {
      allow: [searchForWorkspaceRoot(__dirname)],
    },
    strictPort: true,
  },
});

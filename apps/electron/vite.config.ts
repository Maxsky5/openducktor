import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RENDERER_DEV_PORT = 1430;

const resolveRendererDevPort = (): number => {
  const rendererDevUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (!rendererDevUrl) {
    return DEFAULT_RENDERER_DEV_PORT;
  }

  const port = Number.parseInt(new URL(rendererDevUrl).port, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${rendererDevUrl}`);
  }

  return port;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_ODT_APP_VERSION": JSON.stringify(process.env.ODT_APP_VERSION ?? ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../packages/frontend/src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 500,
  },
  clearScreen: false,
  server: {
    port: resolveRendererDevPort(),
    strictPort: true,
  },
});

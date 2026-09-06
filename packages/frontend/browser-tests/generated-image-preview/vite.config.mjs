import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

// Reuse the shell's installed CSS plugin without adding a browser-test dependency.
const require = createRequire(new URL("../../../../apps/electron/package.json", import.meta.url));
const { default: tailwindcss } = await import(require.resolve("@tailwindcss/vite"));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  server: { host: "127.0.0.1", port: 4198, strictPort: true },
});

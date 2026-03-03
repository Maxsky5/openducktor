import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REACT_VENDOR_PACKAGES = new Set([
  "@remix-run/router",
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "scheduler",
]);
const UI_VENDOR_PACKAGES = new Set([
  "@radix-ui/react-dialog",
  "@radix-ui/react-popover",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "cmdk",
  "lucide-react",
  "radix-ui",
  "sonner",
]);
const MARKDOWN_VENDOR_PACKAGES = new Set(["react-markdown", "remark-gfm"]);
const MARKDOWN_SUPPORT_PACKAGES = new Set([
  "bail",
  "ccount",
  "character-entities",
  "character-entities-html4",
  "character-entities-legacy",
  "comma-separated-tokens",
  "decode-named-character-reference",
  "devlop",
  "extend",
  "hastscript",
  "html-url-attributes",
  "html-void-elements",
  "inline-style-parser",
  "is-plain-obj",
  "longest-streak",
  "markdown-table",
  "parse-entities",
  "property-information",
  "space-separated-tokens",
  "stringify-entities",
  "style-to-js",
  "style-to-object",
  "trim-lines",
  "trough",
  "unified",
  "vfile-message",
  "zwitch",
]);
const VIRTUAL_VENDOR_PACKAGES = new Set(["@tanstack/react-virtual", "@tanstack/virtual-core"]);
const KEEP_NATIVE_SPLITS = [
  "@shikijs/",
  "shiki",
  "react-syntax-highlighter",
  "refractor",
  "oniguruma-parser",
  "oniguruma-to-es",
];

function getNodeModulePackageName(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalizedId.lastIndexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  const packagePath = normalizedId.slice(markerIndex + marker.length);
  const packageSegments = packagePath.split("/");
  if (packageSegments.length === 0) {
    return undefined;
  }

  if (packageSegments[0]?.startsWith("@")) {
    const scope = packageSegments[0];
    const packageName = packageSegments[1];
    if (!scope || !packageName) {
      return undefined;
    }
    return `${scope}/${packageName}`;
  }

  return packageSegments[0];
}

function getVendorChunkName(id: string): string | undefined {
  const packageName = getNodeModulePackageName(id);
  if (!packageName) {
    return undefined;
  }

  if (
    KEEP_NATIVE_SPLITS.some((packagePrefix) =>
      packagePrefix.endsWith("/") ? packageName.startsWith(packagePrefix) : packageName === packagePrefix,
    )
  ) {
    return undefined;
  }

  if (packageName === "@pierre/diffs") {
    return "vendor-diffs";
  }
  if (packageName === "@opencode-ai/sdk") {
    return "vendor-opencode";
  }
  if (packageName === "zod" || packageName === "zod-to-json-schema") {
    return "vendor-zod";
  }

  if (REACT_VENDOR_PACKAGES.has(packageName)) {
    return "vendor-react";
  }
  if (UI_VENDOR_PACKAGES.has(packageName) || packageName.startsWith("@radix-ui/")) {
    return "vendor-ui";
  }
  if (
    MARKDOWN_VENDOR_PACKAGES.has(packageName) ||
    MARKDOWN_SUPPORT_PACKAGES.has(packageName) ||
    packageName.startsWith("remark-") ||
    packageName.startsWith("rehype-") ||
    packageName.startsWith("mdast-") ||
    packageName.startsWith("micromark") ||
    packageName.startsWith("hast-") ||
    packageName.startsWith("unist-") ||
    packageName.startsWith("vfile")
  ) {
    return "vendor-markdown";
  }
  if (VIRTUAL_VENDOR_PACKAGES.has(packageName) || packageName.startsWith("@tanstack/")) {
    return "vendor-virtual";
  }

  return "vendor-misc";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: getVendorChunkName,
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

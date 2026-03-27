import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAppVersion(): string | null {
  try {
    const conf = JSON.parse(
      readFileSync(path.resolve(__dirname, "src-tauri/tauri.conf.json"), "utf-8"),
    );
    return conf.version ?? null;
  } catch (error) {
    console.warn("Could not read app version from tauri.conf.json:", error);
    return null;
  }
}

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
const MARKDOWN_PACKAGE_PREFIXES = [
  "remark-",
  "rehype-",
  "mdast-",
  "micromark",
  "hast-",
  "unist-",
  "vfile",
];
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
  if (packageSegments[0]?.startsWith("@")) {
    if (packageSegments.length < 2 || !packageSegments[1]) {
      return undefined;
    }
    return `${packageSegments[0]}/${packageSegments[1]}`;
  }

  return packageSegments[0] || undefined;
}

function getVendorChunkName(id: string): string | undefined {
  const packageName = getNodeModulePackageName(id);
  if (!packageName) {
    return undefined;
  }

  if (
    KEEP_NATIVE_SPLITS.some((packagePrefix) =>
      packagePrefix.endsWith("/")
        ? packageName.startsWith(packagePrefix)
        : packageName === packagePrefix,
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
    MARKDOWN_PACKAGE_PREFIXES.some((prefix) => packageName.startsWith(prefix))
  ) {
    return "vendor-markdown";
  }
  if (packageName === "@tanstack/react-query") {
    return "vendor-query";
  }

  return "vendor-misc";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_ODT_APP_VERSION": JSON.stringify(
      process.env.ODT_APP_VERSION ?? getAppVersion() ?? "",
    ),
  },
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

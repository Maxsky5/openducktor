import type { AgentFileSearchResultKind } from "../types/agent-orchestrator";

const CSS_EXTENSIONS = new Set(["css", "scss", "sass", "less"]);

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "java",
  "kt",
  "kts",
  "php",
  "phtml",
  "html",
  "htm",
  "rs",
  "py",
  "rb",
  "go",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "cs",
  "swift",
  "scala",
  "sh",
  "bash",
  "zsh",
  "sql",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);

const readLowercaseExtension = (filePath: string): string | null => {
  const normalizedPath = filePath.trim().toLowerCase();
  const extensionIndex = normalizedPath.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === normalizedPath.length - 1) {
    return null;
  }
  return normalizedPath.slice(extensionIndex + 1);
};

export const detectAgentFileReferenceKind = (input: {
  filePath: string;
  mime?: string;
  isDirectory?: boolean;
}): AgentFileSearchResultKind => {
  if (input.isDirectory || input.mime === "inode/directory") {
    return "directory";
  }

  if (input.mime?.startsWith("image/")) {
    return "image";
  }

  if (input.mime?.startsWith("video/")) {
    return "video";
  }

  const extension = readLowercaseExtension(input.filePath);
  if (!extension) {
    return "default";
  }

  if (CSS_EXTENSIONS.has(extension)) {
    return "css";
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  return "default";
};

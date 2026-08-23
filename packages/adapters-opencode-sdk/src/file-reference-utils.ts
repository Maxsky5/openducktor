import { hasOwnKey } from "@openducktor/contracts";
import { type AgentFileReference, detectAgentFileReferenceKind } from "@openducktor/core";

const IMAGE_MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
} satisfies Record<string, string>;

const VIDEO_MIME_BY_EXTENSION = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
} satisfies Record<string, string>;

const readLowercaseExtension = (filePath: string): string | null => {
  const normalizedPath = filePath.trim().toLowerCase();
  const extensionIndex = normalizedPath.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === normalizedPath.length - 1) {
    return null;
  }
  return normalizedPath.slice(extensionIndex + 1);
};

export { detectAgentFileReferenceKind };

export const detectAgentFileReferenceMime = (
  file: Pick<AgentFileReference, "kind" | "path">,
): string => {
  if (file.kind === "directory") {
    return "inode/directory";
  }

  const extension = readLowercaseExtension(file.path);
  if (file.kind === "image") {
    return extension && hasOwnKey(IMAGE_MIME_BY_EXTENSION, extension)
      ? IMAGE_MIME_BY_EXTENSION[extension]
      : "image/png";
  }

  if (file.kind === "video") {
    return extension && hasOwnKey(VIDEO_MIME_BY_EXTENSION, extension)
      ? VIDEO_MIME_BY_EXTENSION[extension]
      : "video/mp4";
  }

  return "text/plain";
};

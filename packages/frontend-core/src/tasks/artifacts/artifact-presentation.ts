import type { FreeTaskArtifact, TaskArtifact, WorkflowTaskArtifact } from "@openducktor/contracts";
import { workflowArtifactOrder } from "@openducktor/workflows";

/** The collection as both clients list it: workflow artifacts in workflow order, then files by name. */
export const groupTaskArtifacts = (artifacts: readonly TaskArtifact[]) => ({
  workflow: artifacts
    .filter((item): item is WorkflowTaskArtifact => item.classification === "workflow")
    .toSorted((a, b) => workflowArtifactOrder(a.code) - workflowArtifactOrder(b.code)),
  files: artifacts
    .filter((item): item is FreeTaskArtifact => item.classification === "free")
    .toSorted((a, b) => a.name.localeCompare(b.name)),
});

const FORMAT_LABELS = new Map([
  ["text/markdown", "Markdown"],
  ["text/plain", "Text"],
  ["text/html", "HTML"],
  ["image/png", "PNG"],
  ["image/jpeg", "JPEG"],
  ["image/webp", "WebP"],
  ["image/gif", "GIF"],
  ["image/svg+xml", "SVG"],
  ["application/pdf", "PDF"],
]);

/** The short format name of a media type, such as PNG, or File for another format. */
export const artifactFormatLabel = (mediaType: string): string =>
  FORMAT_LABELS.get(mediaType.toLowerCase()) ?? "File";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export type ArtifactPreviewKind = "markdown" | "text" | "html" | "image" | "none";

const IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

/** How a client previews an artifact of this media type. Other formats have no preview. */
export const artifactPreviewKind = (mediaType: string): ArtifactPreviewKind => {
  const type = mediaType.toLowerCase();
  if (type === "text/markdown") return "markdown";
  if (type === "text/plain") return "text";
  if (type === "text/html") return "html";
  return IMAGE_MEDIA_TYPES.has(type) ? "image" : "none";
};

/**
 * The literal text of a text artifact, with a leading byte order mark kept. Null when the bytes
 * are not valid UTF-8, so a preview never shows replacement characters.
 */
export const decodeArtifactText = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
};

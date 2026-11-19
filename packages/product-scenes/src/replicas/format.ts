// Formats of the product UI, shared by the replica markup and the scene scripts.

/** The context use of a session: the part of the window in use, and the tokens. */
export type ContextUse = { percent: number; tokens: number };

/** A lane count in the header of a Kanban lane: kanban-column.tsx and board-lane.tsx of the mobile app. */
export function laneCountLabel(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

/** A token count in the composer format of format-token-count.ts, such as 18.4K or 112K. */
export function compactTokens(tokens: number): string {
  const thousands = tokens / 1000;
  const text = thousands >= 100 ? `${Math.round(thousands)}` : thousands.toFixed(1);
  return `${text.replace(/\.0$/, "")}K`;
}

/** The file count of the Diffs tab: git-info-header.tsx. */
export function filesLabel(count: number): string {
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

/** The short formats of the media types: FORMAT_LABELS of artifact-presentation.ts. */
const ARTIFACT_FORMATS = new Map([
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

/** The format of an artifact, such as HTML: artifactFormatLabel of artifact-presentation.ts. */
export function artifactFormat(mediaType: string): string {
  return ARTIFACT_FORMATS.get(mediaType.toLowerCase()) ?? "File";
}

/** The size of a file, such as 6.2 KiB: formatFileSize of artifact-presentation.ts. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

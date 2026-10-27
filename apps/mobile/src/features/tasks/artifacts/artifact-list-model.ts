import type { TaskArtifact } from "@openducktor/contracts";
import { formatElapsedAgo } from "@openducktor/frontend-core/lib/relative-time";
import {
  artifactFormatLabel,
  formatFileSize,
} from "@openducktor/frontend-core/tasks/artifacts/artifact-presentation";
import type { HostDocumentKey } from "@/features/tasks/documents/document-rows";
import type { IconName } from "@/ui/icon";

/** The icon of an artifact, as the desktop collection shows it. */
export const artifactIcon = (mediaType: string): IconName => {
  const type = mediaType.toLowerCase();
  if (type.startsWith("image/")) return "file-image";
  if (type === "text/html" || type === "application/json") return "file-code-2";
  return "file-text";
};

/** The detail line of an artifact, such as "PNG · 12.0 KiB · 3m ago". */
export const artifactDetail = (artifact: TaskArtifact, now: number): string =>
  [
    artifactFormatLabel(artifact.mediaType),
    artifact.classification === "free" ? formatFileSize(artifact.byteSize) : null,
    artifact.updatedAt ? formatElapsedAgo(now - Date.parse(artifact.updatedAt)) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

const WORKFLOW_DOCUMENT_KEYS = new Map<string, HostDocumentKey>([
  ["spec", "spec"],
  ["plan", "plan"],
  ["qaReport", "qa"],
]);

/** The Documents view of a built-in workflow artifact code. */
export const workflowDocumentKey = (code: string): HostDocumentKey => {
  const key = WORKFLOW_DOCUMENT_KEYS.get(code);
  if (key === undefined) {
    throw new Error(
      `The built-in workflow has no artifact "${code}". Report this host data error.`,
    );
  }
  return key;
};

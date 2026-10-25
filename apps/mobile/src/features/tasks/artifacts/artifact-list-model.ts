import type { TaskArtifact, WorkflowTaskArtifact } from "@openducktor/contracts";
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

/** The Documents view of a workflow artifact. */
export const workflowDocumentKey = (
  workflowKind: WorkflowTaskArtifact["workflowKind"],
): HostDocumentKey => (workflowKind === "qaReport" ? "qa" : workflowKind);

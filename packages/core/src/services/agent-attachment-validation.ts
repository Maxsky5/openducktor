import type { AgentAttachmentKind, AgentModelAttachmentSupport } from "../types/agent-orchestrator";

export const ATTACHMENT_EXTENSION_MIME: ReadonlyMap<string, string> = new Map<string, string>([
  [".avif", "image/avif"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".flac", "audio/flac"],
  [".mp4", "video/mp4"],
  [".m4v", "video/x-m4v"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".ogv", "video/ogg"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".pdf", "application/pdf"],
]);

const readFileExtension = (name: string): string => {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
};

/** The attachment fields that a model support check reads. */
export type AttachmentToCheck = {
  readonly kind: AgentAttachmentKind;
  readonly name: string;
  readonly mime?: string | undefined;
};

export const readAttachmentValidationError = (
  attachment: AttachmentToCheck,
  support: AgentModelAttachmentSupport | null | undefined,
  modelLabel = "The selected model",
): string | null => {
  if (!support) {
    return `${modelLabel} does not expose attachment capability data.`;
  }

  if (!support[attachment.kind]) {
    return `${modelLabel} does not support ${attachment.kind} attachments.`;
  }

  const supportedMimeTypes = support.mimeTypes?.[attachment.kind];
  if (!supportedMimeTypes || supportedMimeTypes.length === 0) {
    return null;
  }

  const reportedMime = attachment.mime?.trim().toLowerCase();
  if (reportedMime && supportedMimeTypes.includes(reportedMime)) return null;
  // Preserve the known platform JPEG alias and generic file metadata.
  const mime = reportedMime === "image/jpg" ? "image/jpeg" : reportedMime;
  if (mime && supportedMimeTypes.includes(mime)) {
    return null;
  }

  if (!mime || mime === "application/octet-stream") {
    const extension = readFileExtension(attachment.name);
    const inferredMime = ATTACHMENT_EXTENSION_MIME.get(extension);
    if (inferredMime && supportedMimeTypes.includes(inferredMime)) {
      return null;
    }
  }

  return `${modelLabel} supports ${attachment.kind} attachments only as ${supportedMimeTypes.join(", ")}.`;
};

import type { AgentAttachmentKind, AgentModelAttachmentSupport } from "@openducktor/core";
import {
  type AgentChatComposerAttachment,
  createComposerAttachment,
} from "./agent-chat-composer-draft";

const ATTACHMENT_EXTENSION_KIND: Record<string, AgentAttachmentKind> = {
  ".avif": "image",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".heic": "image",
  ".heif": "image",
  ".tif": "image",
  ".tiff": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image",
  ".mp3": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".ogg": "audio",
  ".oga": "audio",
  ".opus": "audio",
  ".flac": "audio",
  ".mp4": "video",
  ".m4v": "video",
  ".mov": "video",
  ".webm": "video",
  ".ogv": "video",
  ".mkv": "video",
  ".avi": "video",
  ".pdf": "pdf",
};

const ATTACHMENT_EXTENSION_MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".pdf": "application/pdf",
};

const ATTACHMENT_MIME_EXTENSION = Object.entries(ATTACHMENT_EXTENSION_MIME).reduce<
  Record<string, string>
>((acc, [extension, mime]) => {
  acc[mime] ??= extension;
  return acc;
}, {});

const ATTACHMENT_KIND_DEFAULT_NAME: Record<AgentAttachmentKind, string> = {
  image: "pasted-image",
  audio: "pasted-audio",
  video: "pasted-video",
  pdf: "pasted-pdf",
};

export const CHAT_ATTACHMENT_ACCEPT = "image/*,audio/*,video/*,.pdf,application/pdf";

const readFileExtension = (name: string): string => {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
};

export const readAttachmentNameFromPath = (path: string): string => {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? path;
};

export const classifyAttachment = (input: {
  name: string;
  mime?: string;
}): AgentAttachmentKind | null => {
  const mime = input.mime?.trim().toLowerCase();
  if (mime) {
    if (mime.startsWith("image/")) {
      return "image";
    }
    if (mime.startsWith("audio/")) {
      return "audio";
    }
    if (mime.startsWith("video/")) {
      return "video";
    }
    if (mime === "application/pdf") {
      return "pdf";
    }
  }

  return ATTACHMENT_EXTENSION_KIND[readFileExtension(input.name)] ?? null;
};

const inferAttachmentMime = (name: string, mime?: string): string | undefined => {
  const trimmedMime = mime?.trim();
  if (trimmedMime) {
    return trimmedMime;
  }
  return ATTACHMENT_EXTENSION_MIME[readFileExtension(name)];
};

const normalizeAttachmentFileName = (file: File, kind: AgentAttachmentKind): File => {
  if (file.name.trim().length > 0) {
    return file;
  }

  const extension = ATTACHMENT_MIME_EXTENSION[file.type.trim().toLowerCase()] ?? "";
  const name = `${ATTACHMENT_KIND_DEFAULT_NAME[kind]}${extension}`;

  return new File([file], name, {
    type: file.type,
    lastModified: file.lastModified,
  });
};

export const buildComposerAttachmentFromFile = (file: File): AgentChatComposerAttachment | null => {
  const kind = classifyAttachment({ name: file.name, mime: file.type });
  if (!kind) {
    return null;
  }
  const normalizedFile = normalizeAttachmentFileName(file, kind);
  const mime = inferAttachmentMime(normalizedFile.name, normalizedFile.type);

  return createComposerAttachment({
    name: normalizedFile.name,
    kind,
    ...(mime ? { mime } : {}),
    file: normalizedFile,
  });
};

export const buildComposerAttachmentFromPath = (
  path: string,
  metadata?: Pick<AgentChatComposerAttachment, "kind" | "mime" | "name">,
): AgentChatComposerAttachment | null => {
  const name = metadata?.name ?? readAttachmentNameFromPath(path);
  const kind =
    metadata?.kind ??
    classifyAttachment({
      name,
      ...(metadata?.mime ? { mime: metadata.mime } : {}),
    });
  if (!kind) {
    return null;
  }
  const mime = inferAttachmentMime(name, metadata?.mime);

  return createComposerAttachment({
    name,
    kind,
    path,
    ...(mime ? { mime } : {}),
  });
};

export const isPreviewableAttachmentKind = (kind: AgentAttachmentKind): boolean => {
  return kind === "image" || kind === "video";
};

export const readAttachmentValidationError = (
  attachment: Pick<AgentChatComposerAttachment, "kind">,
  support: AgentModelAttachmentSupport | null | undefined,
): string | null => {
  if (!support) {
    return "The selected model does not expose attachment capability data.";
  }

  if (support[attachment.kind]) {
    return null;
  }

  return `The selected model does not support ${attachment.kind} attachments.`;
};

export const validateComposerAttachments = (
  attachments: AgentChatComposerAttachment[],
  support: AgentModelAttachmentSupport | null | undefined,
): Record<string, string> => {
  return attachments.reduce<Record<string, string>>((acc, attachment) => {
    const error = readAttachmentValidationError(attachment, support);
    if (error) {
      acc[attachment.id] = error;
    }
    return acc;
  }, {});
};

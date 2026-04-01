import type { AgentAttachmentKind, AgentModelAttachmentSupport } from "@openducktor/core";
import {
  type AgentChatComposerAttachment,
  createComposerAttachment,
} from "./agent-chat-composer-draft";

const ATTACHMENT_EXTENSION_KIND: Record<string, AgentAttachmentKind> = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image",
  ".mp3": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".ogg": "audio",
  ".flac": "audio",
  ".mp4": "video",
  ".mov": "video",
  ".webm": "video",
  ".mkv": "video",
  ".avi": "video",
  ".pdf": "pdf",
};

const ATTACHMENT_EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".pdf": "application/pdf",
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

const readNonstandardBrowserFilePath = (file: File): string | undefined => {
  const candidate = (file as File & { path?: unknown }).path;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
};

export const buildComposerAttachmentFromFile = (file: File): AgentChatComposerAttachment | null => {
  const kind = classifyAttachment({ name: file.name, mime: file.type });
  if (!kind) {
    return null;
  }
  const mime = inferAttachmentMime(file.name, file.type);
  const path = readNonstandardBrowserFilePath(file);

  return createComposerAttachment({
    name: file.name,
    kind,
    ...(mime ? { mime } : {}),
    ...(path ? { path } : {}),
    file,
  });
};

export const buildComposerAttachmentFromPath = (
  path: string,
): AgentChatComposerAttachment | null => {
  const name = readAttachmentNameFromPath(path);
  const kind = classifyAttachment({ name });
  if (!kind) {
    return null;
  }
  const mime = inferAttachmentMime(name);

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

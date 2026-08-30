import { hasOwnKey, LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type { AgentAttachmentKind, AgentModelAttachmentSupport } from "@openducktor/core";
import { basenameForPath } from "@openducktor/path-support";
import {
  type AgentChatComposerAttachment,
  createComposerAttachment,
} from "./agent-chat-composer-draft";

const ATTACHMENT_EXTENSION_KIND = {
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
} satisfies Record<string, AgentAttachmentKind>;

const ATTACHMENT_EXTENSION_MIME = {
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
} satisfies Record<string, string>;

const ATTACHMENT_MIME_EXTENSION = Object.entries(ATTACHMENT_EXTENSION_MIME).reduce<
  Record<string, string>
>((acc, [extension, mime]) => {
  acc[mime] ??= extension;
  return acc;
}, {});

const ATTACHMENT_KIND_DEFAULT_NAME = {
  image: "pasted-image",
  audio: "pasted-audio",
  video: "pasted-video",
  pdf: "pasted-pdf",
} satisfies Record<AgentAttachmentKind, string>;

const GENERIC_ATTACHMENT_DEFAULT_NAME = "pasted-attachment";

export const CHAT_ATTACHMENT_ACCEPT = "image/*,audio/*,video/*,.pdf,application/pdf";

const readFileExtension = (name: string): string => {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
};

export const readAttachmentNameFromPath = (path: string): string => basenameForPath(path) || path;

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

  const extension = readFileExtension(input.name);
  return hasOwnKey(ATTACHMENT_EXTENSION_KIND, extension)
    ? ATTACHMENT_EXTENSION_KIND[extension]
    : null;
};

const inferAttachmentMime = (name: string, mime?: string): string | undefined => {
  const trimmedMime = mime?.trim();
  if (trimmedMime) {
    return trimmedMime;
  }
  const extension = readFileExtension(name);
  return hasOwnKey(ATTACHMENT_EXTENSION_MIME, extension)
    ? ATTACHMENT_EXTENSION_MIME[extension]
    : undefined;
};

const buildGeneratedAttachmentName = (kind: AgentAttachmentKind | null, mime?: string): string => {
  const normalizedMime = mime?.trim().toLowerCase();
  const extension = normalizedMime ? (ATTACHMENT_MIME_EXTENSION[normalizedMime] ?? "") : "";
  const baseName = kind ? ATTACHMENT_KIND_DEFAULT_NAME[kind] : GENERIC_ATTACHMENT_DEFAULT_NAME;

  return `${baseName}${extension}`;
};

export const readAttachmentFileName = (input: {
  name: string;
  mime?: string;
  kind?: AgentAttachmentKind | null;
}): string => {
  if (input.name.trim().length > 0) {
    return input.name;
  }

  const classificationInput: Parameters<typeof classifyAttachment>[0] = { name: input.name };
  if (input.mime) classificationInput.mime = input.mime;
  return buildGeneratedAttachmentName(
    input.kind ?? classifyAttachment(classificationInput),
    input.mime,
  );
};

const normalizeAttachmentFile = (file: File, kind: AgentAttachmentKind): File => {
  const normalizedName = readAttachmentFileName({
    name: file.name,
    mime: file.type,
    kind,
  });
  if (normalizedName === file.name) {
    return file;
  }

  return new File([file], normalizedName, {
    type: file.type,
    lastModified: file.lastModified,
  });
};

export const buildComposerAttachmentFromFile = (file: File): AgentChatComposerAttachment | null => {
  const kind = classifyAttachment({ name: file.name, mime: file.type });
  if (!kind) {
    return null;
  }
  const normalizedFile = normalizeAttachmentFile(file, kind);
  const mime = inferAttachmentMime(normalizedFile.name, normalizedFile.type);

  const attachment: Parameters<typeof createComposerAttachment>[0] = {
    name: normalizedFile.name,
    kind,
    file: normalizedFile,
  };
  if (mime) attachment.mime = mime;
  return createComposerAttachment(attachment);
};

export const buildComposerAttachmentFromPath = (
  path: string,
  metadata?: Pick<AgentChatComposerAttachment, "kind" | "mime" | "name">,
): AgentChatComposerAttachment | null => {
  const name = metadata?.name ?? readAttachmentNameFromPath(path);
  const classificationInput: Parameters<typeof classifyAttachment>[0] = { name };
  if (metadata?.mime) classificationInput.mime = metadata.mime;
  const kind = metadata?.kind ?? classifyAttachment(classificationInput);
  if (!kind) {
    return null;
  }
  const mime = inferAttachmentMime(name, metadata?.mime);

  const attachment: Parameters<typeof createComposerAttachment>[0] = {
    name,
    kind,
    path,
  };
  if (mime) attachment.mime = mime;
  return createComposerAttachment(attachment);
};

export const isPreviewableAttachmentKind = (kind: AgentAttachmentKind): boolean => {
  return kind === "image" || kind === "video";
};

const readAttachmentValidationError = (
  attachment: Pick<AgentChatComposerAttachment, "kind" | "mime" | "name">,
  support: AgentModelAttachmentSupport | null | undefined,
): string | null => {
  if (!support) {
    return "The selected model does not expose attachment capability data.";
  }

  if (!support[attachment.kind]) {
    return `The selected model does not support ${attachment.kind} attachments.`;
  }

  const supportedMimeTypes = support.mimeTypes?.[attachment.kind];
  if (!supportedMimeTypes || supportedMimeTypes.length === 0) {
    return null;
  }

  const mime = attachment.mime?.trim().toLowerCase();
  if (mime && supportedMimeTypes.includes(mime)) {
    return null;
  }

  const extension = readFileExtension(attachment.name);
  const inferredMime = hasOwnKey(ATTACHMENT_EXTENSION_MIME, extension)
    ? ATTACHMENT_EXTENSION_MIME[extension]
    : undefined;
  if (inferredMime && supportedMimeTypes.includes(inferredMime)) {
    return null;
  }

  return `The selected model supports ${attachment.kind} attachments only as ${supportedMimeTypes.join(", ")}.`;
};

export const validateComposerAttachments = (
  attachments: AgentChatComposerAttachment[],
  support: AgentModelAttachmentSupport | null | undefined,
): Record<string, string> => {
  let totalFileBytes = 0;
  return attachments.reduce<Record<string, string>>((acc, attachment) => {
    totalFileBytes += attachment.file?.size ?? 0;
    if (totalFileBytes > LOCAL_ATTACHMENT_BYTE_LIMIT) {
      acc[attachment.id] = "Attachments must total 32 MiB or less.";
      return acc;
    }
    const error = readAttachmentValidationError(attachment, support);
    if (error) {
      acc[attachment.id] = error;
    }
    return acc;
  }, {});
};

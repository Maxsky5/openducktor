import { ATTACHMENT_EXTENSION_MIME, readAttachmentValidationError } from "@openducktor/core";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type {
  AttachmentToCheck,
  AgentAttachmentKind,
  AgentAttachmentReference,
  AgentModelAttachmentSupport,
  AgentModelCatalog,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import { basenameForPath } from "@openducktor/path-support";
import {
  type AgentChatComposerAttachment,
  createComposerAttachment,
} from "./agent-chat-composer-draft";

export type { AttachmentToCheck } from "@openducktor/core";

const ATTACHMENT_EXTENSION_KIND = new Map<string, AgentAttachmentKind>([
  [".avif", "image"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".heic", "image"],
  [".heif", "image"],
  [".tif", "image"],
  [".tiff", "image"],
  [".webp", "image"],
  [".svg", "image"],
  [".bmp", "image"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".aac", "audio"],
  [".ogg", "audio"],
  [".oga", "audio"],
  [".opus", "audio"],
  [".flac", "audio"],
  [".mp4", "video"],
  [".m4v", "video"],
  [".mov", "video"],
  [".webm", "video"],
  [".ogv", "video"],
  [".mkv", "video"],
  [".avi", "video"],
  [".pdf", "pdf"],
]);

const ATTACHMENT_MIME_EXTENSION = new Map<string, string>();
for (const [extension, mime] of ATTACHMENT_EXTENSION_MIME) {
  if (!ATTACHMENT_MIME_EXTENSION.has(mime)) {
    ATTACHMENT_MIME_EXTENSION.set(mime, extension);
  }
}

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
  return ATTACHMENT_EXTENSION_KIND.get(extension) ?? null;
};

const inferAttachmentMime = (name: string, mime?: string): string | undefined => {
  const trimmedMime = mime?.trim();
  if (trimmedMime) {
    return trimmedMime;
  }
  const extension = readFileExtension(name);
  return ATTACHMENT_EXTENSION_MIME.get(extension);
};

const buildGeneratedAttachmentName = (kind: AgentAttachmentKind | null, mime?: string): string => {
  const normalizedMime = mime?.trim().toLowerCase();
  const extension = normalizedMime ? (ATTACHMENT_MIME_EXTENSION.get(normalizedMime) ?? "") : "";
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
  if (input.mime) {
    classificationInput.mime = input.mime;
  }
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
  if (mime) {
    attachment.mime = mime;
  }
  return createComposerAttachment(attachment);
};

export const buildComposerAttachmentFromPath = (
  path: string,
  metadata?: Pick<AgentChatComposerAttachment, "kind" | "mime" | "name">,
): AgentChatComposerAttachment | null => {
  const name = metadata?.name ?? readAttachmentNameFromPath(path);
  const classificationInput: Parameters<typeof classifyAttachment>[0] = { name };
  if (metadata?.mime) {
    classificationInput.mime = metadata.mime;
  }
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
  if (mime) {
    attachment.mime = mime;
  }
  return createComposerAttachment(attachment);
};

export const isPreviewableAttachmentKind = (kind: AgentAttachmentKind): boolean => {
  return kind === "image" || kind === "video";
};

/**
 * A steer joins the running turn, so its attachments must suit the model of that turn, not the
 * model that the composer selects for later messages.
 */
export const runningTurnAttachmentBlockedReason = (
  attachments: readonly AttachmentToCheck[],
  runningTurnModel: AgentModelCatalog["models"][number] | null,
): string | null => {
  if (attachments.length === 0) return null;
  if (!runningTurnModel) {
    return "The model of the running turn is unknown, so its attachment support cannot be checked. Queue the message instead.";
  }
  for (const attachment of attachments) {
    const error = readAttachmentValidationError(
      attachment,
      runningTurnModel.attachmentSupport,
      "The model of the running turn",
    );
    if (error) return `${attachment.name}: ${error}`;
  }
  return null;
};

export const validateComposerAttachments = (
  attachments: AgentChatComposerAttachment[],
  support: AgentModelAttachmentSupport | null | undefined,
  modelLabel = "The selected model",
): Record<string, string> => {
  let totalFileBytes = 0;
  return attachments.reduce<Record<string, string>>((acc, attachment) => {
    totalFileBytes += attachment.file?.size ?? 0;
    if (totalFileBytes > LOCAL_ATTACHMENT_BYTE_LIMIT) {
      acc[attachment.id] = "Attachments must total 32 MiB or less.";
      return acc;
    }
    const error = readAttachmentValidationError(attachment, support, modelLabel);
    if (error) {
      acc[attachment.id] = error;
    }
    return acc;
  }, {});
};

type TranscriptAttachmentReference = AgentAttachmentReference & {
  localPreviewAvailable?: boolean;
};

/** Copies the attachment fields that a transcript chip shows. */
export const toTranscriptAttachment = (
  attachment: Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>["attachment"],
): TranscriptAttachmentReference => {
  const reference: TranscriptAttachmentReference = {
    id: attachment.id,
    path: attachment.path,
    name: attachment.name,
    kind: attachment.kind,
  };
  if (attachment.mime !== undefined) {
    reference.mime = attachment.mime;
  }
  if (attachment.localPreviewAvailable !== undefined) {
    reference.localPreviewAvailable = attachment.localPreviewAvailable;
  }
  return reference;
};

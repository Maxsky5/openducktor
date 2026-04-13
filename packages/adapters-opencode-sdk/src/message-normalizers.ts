import type { Part } from "@opencode-ai/sdk/v2/client";
import type {
  AgentModelSelection,
  AgentUserMessageDisplayPart,
  AgentUserMessagePart,
  AgentUserMessageSourceText,
} from "@openducktor/core";
import { detectAgentFileReferenceKind } from "./file-reference-utils";
import { asUnknownRecord, readRecordProp, readUnknownProp } from "./guards";
import { buildOpenCodeVisibleText } from "./opencode-user-message-encoding";

export const readTextFromParts = (parts: Part[]): string => {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const readPathBasename = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? filePath;
};

const readFilePathFromUrl = (url: string): string | null => {
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return null;
  }
  if (trimmedUrl.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmedUrl)) {
    return trimmedUrl;
  }

  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== "file:") {
      return null;
    }
    const pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return null;
  }
};

const normalizeSourceText = (value: unknown): AgentUserMessageSourceText | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const textValue = record.value;
  const start = record.start;
  const end = record.end;
  if (typeof textValue !== "string" || typeof start !== "number" || typeof end !== "number") {
    return undefined;
  }
  return {
    value: textValue,
    start,
    end,
  };
};

const normalizeAttachmentPart = (
  part: Extract<Part, { type: "file" }>,
): AgentUserMessageDisplayPart | null => {
  const sourcePath = part.source?.type === "file" ? part.source.path.trim() : "";
  const filePath = readFilePathFromUrl(part.url) ?? (sourcePath || part.filename?.trim() || "");
  if (filePath.length === 0 || !part.mime) {
    return null;
  }

  const name = part.filename?.trim() || readPathBasename(filePath);
  if (part.mime.startsWith("image/")) {
    return {
      kind: "attachment",
      attachment: {
        id: part.id,
        path: filePath,
        name,
        kind: "image",
        mime: part.mime,
      },
    };
  }
  if (part.mime.startsWith("audio/")) {
    return {
      kind: "attachment",
      attachment: {
        id: part.id,
        path: filePath,
        name,
        kind: "audio",
        mime: part.mime,
      },
    };
  }
  if (part.mime.startsWith("video/")) {
    return {
      kind: "attachment",
      attachment: {
        id: part.id,
        path: filePath,
        name,
        kind: "video",
        mime: part.mime,
      },
    };
  }
  if (part.mime === "application/pdf") {
    return {
      kind: "attachment",
      attachment: {
        id: part.id,
        path: filePath,
        name,
        kind: "pdf",
        mime: part.mime,
      },
    };
  }

  return null;
};

const normalizeFileReferencePart = (
  part: Extract<Part, { type: "file" }>,
): AgentUserMessageDisplayPart | null => {
  const source = part.source;
  const sourceTextValue = source?.type === "file" ? (source.text?.value?.trim() ?? "") : "";
  const isRepoFileReference = sourceTextValue.startsWith("@");
  if (source?.type !== "file" || !source.text || !isRepoFileReference) {
    return normalizeAttachmentPart(part);
  }
  const sourcePath = source?.type === "file" ? source.path.trim() : "";
  const filePath =
    sourcePath.length > 0
      ? sourcePath
      : (readFilePathFromUrl(part.url) ?? part.filename?.trim() ?? "");
  if (filePath.length === 0) {
    return null;
  }

  const name = part.filename?.trim() || readPathBasename(filePath);
  const sourceText = normalizeSourceText(source.text);
  return {
    kind: "file_reference",
    file: {
      id: part.id,
      path: filePath,
      name,
      kind: detectAgentFileReferenceKind({ filePath, mime: part.mime }),
    },
    ...(sourceText ? { sourceText } : {}),
  };
};

export const normalizeUserMessageDisplayParts = (parts: Part[]): AgentUserMessageDisplayPart[] => {
  return parts.flatMap((part) => {
    if (part.type === "text") {
      if (part.synthetic || part.ignored || part.text.length === 0) {
        return [];
      }
      return [{ kind: "text", text: part.text } satisfies AgentUserMessageDisplayPart];
    }

    if (part.type === "file") {
      const fileReference = normalizeFileReferencePart(part);
      return fileReference ? [fileReference] : [];
    }

    return [];
  });
};

export const hasVisibleUserTextDisplayPart = (parts: AgentUserMessageDisplayPart[]): boolean => {
  return parts.some((part) => part.kind === "text" && !part.synthetic && part.text.length > 0);
};

export const ensureVisibleUserTextDisplayParts = (
  parts: AgentUserMessageDisplayPart[],
  fallbackText: string,
): AgentUserMessageDisplayPart[] => {
  if (hasVisibleUserTextDisplayPart(parts) || fallbackText.length === 0) {
    return parts;
  }

  return [{ kind: "text", text: fallbackText }, ...parts];
};

export const mergePreservedAttachmentDisplayParts = (
  displayParts: AgentUserMessageDisplayPart[],
  preservedAttachmentParts: Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>[],
): AgentUserMessageDisplayPart[] => {
  if (preservedAttachmentParts.length === 0) {
    return displayParts;
  }

  const remainingPreservedAttachments = [...preservedAttachmentParts];
  const mergedParts = displayParts.map((part) => {
    if (part.kind !== "attachment") {
      return part;
    }

    const preservedIndex = remainingPreservedAttachments.findIndex(
      (candidate) =>
        candidate.attachment.name === part.attachment.name &&
        candidate.attachment.kind === part.attachment.kind &&
        (candidate.attachment.mime ?? "") === (part.attachment.mime ?? ""),
    );
    if (preservedIndex < 0) {
      return part;
    }

    const preservedAttachment = remainingPreservedAttachments.splice(preservedIndex, 1)[0];
    if (!preservedAttachment) {
      return part;
    }

    return {
      ...part,
      attachment: {
        ...part.attachment,
        path: preservedAttachment.attachment.path,
      },
    };
  });

  return [...mergedParts, ...remainingPreservedAttachments];
};

export const readVisibleUserTextFromDisplayParts = (
  parts: AgentUserMessageDisplayPart[],
): string => {
  const visibleText = parts
    .filter(
      (part): part is Extract<AgentUserMessageDisplayPart, { kind: "text" }> =>
        part.kind === "text" && !part.synthetic,
    )
    .map((part) => part.text)
    .join("");
  if (visibleText.length > 0) {
    return visibleText;
  }

  const userMessageParts = parts.flatMap<AgentUserMessagePart>((part) => {
    if (part.kind === "text") {
      return part.synthetic ? [] : [{ kind: "text", text: part.text }];
    }

    if (part.kind === "attachment") {
      return [];
    }

    return [{ kind: "file_reference", file: part.file }];
  });

  return buildOpenCodeVisibleText(userMessageParts);
};

export const readTextFromMessageInfo = (info: unknown): string => {
  const record = asUnknownRecord(info);
  if (!record) {
    return "";
  }

  const direct =
    readUnknownProp(record, "text") ??
    readUnknownProp(record, "content") ??
    readUnknownProp(readRecordProp(record, "message"), "text");
  return typeof direct === "string" ? direct : "";
};

export const sanitizeAssistantMessage = (rawMessage: string): string => rawMessage.trim();

export const readMessageModelSelection = (info: unknown): AgentModelSelection | undefined => {
  const record = asUnknownRecord(info);
  if (!record) {
    return undefined;
  }

  const nestedModel = readRecordProp(record, "model");
  const providerId =
    readUnknownProp(record, "providerID") ?? readUnknownProp(nestedModel, "providerID");
  const modelId = readUnknownProp(record, "modelID") ?? readUnknownProp(nestedModel, "modelID");
  const variant = readUnknownProp(record, "variant");
  const profileId = readUnknownProp(record, "agent");
  if (typeof providerId !== "string" || typeof modelId !== "string") {
    return undefined;
  }

  return {
    providerId,
    modelId,
    ...(typeof variant === "string" && variant.trim().length > 0 ? { variant } : {}),
    ...(typeof profileId === "string" && profileId.trim().length > 0 ? { profileId } : {}),
  };
};

type TokenBreakdown = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const sumTokenBreakdown = (breakdown: TokenBreakdown | null | undefined): number => {
  if (!breakdown || typeof breakdown !== "object") {
    return 0;
  }
  const input = toFiniteNumber(breakdown.input) ?? 0;
  const output = toFiniteNumber(breakdown.output) ?? 0;
  const reasoning = toFiniteNumber(breakdown.reasoning) ?? 0;
  const cacheRead = toFiniteNumber(breakdown.cache?.read) ?? 0;
  const cacheWrite = toFiniteNumber(breakdown.cache?.write) ?? 0;
  return Math.max(0, input + output + reasoning + cacheRead + cacheWrite);
};

export const toTokenTotal = (value: unknown): number | undefined => {
  const direct = toFiniteNumber(value);
  if (direct !== null) {
    return Math.max(0, direct);
  }
  if (value && typeof value === "object") {
    const summed = sumTokenBreakdown(value as TokenBreakdown);
    if (summed > 0) {
      return summed;
    }
  }
  return undefined;
};

export const extractMessageTotalTokens = (
  info: unknown,
  parts: Array<Part | Record<string, unknown>>,
): number | undefined => {
  const infoTokens = toTokenTotal(readUnknownProp(info, "tokens"));
  if (typeof infoTokens === "number" && infoTokens > 0) {
    return infoTokens;
  }

  let maxPartTokens = 0;
  for (const part of parts) {
    const partTokens = toTokenTotal(readUnknownProp(part, "tokens"));
    if (typeof partTokens === "number" && partTokens > maxPartTokens) {
      maxPartTokens = partTokens;
    }
  }

  return maxPartTokens > 0 ? maxPartTokens : undefined;
};

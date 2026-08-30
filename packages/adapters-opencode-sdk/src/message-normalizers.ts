import type {
  AgentModelSelection,
  AgentSubagentReference,
  AgentUserMessageDisplayPart,
  AgentUserMessagePart,
} from "@openducktor/core";
import { basenameForPath } from "@openducktor/path-support";
import { detectAgentFileReferenceKind } from "./file-reference-utils";
import { buildOpenCodeVisibleText } from "./opencode-user-message-encoding";
import type { ParsedOpencodeMessage, ParsedOpencodePart } from "./opencode-ingress";

const AUTO_SLASH_COMMAND_OPEN = "<auto-slash-command>";
const AUTO_SLASH_COMMAND_CLOSE = "</auto-slash-command>";

export const readTextFromParts = (parts: ParsedOpencodePart[]): string => {
  return parts
    .filter((part): part is Extract<ParsedOpencodePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
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

const normalizeAttachmentPart = (
  part: Extract<ParsedOpencodePart, { type: "file" }>,
): AgentUserMessageDisplayPart | null => {
  const sourcePath = part.source?.type === "file" ? part.source.path.trim() : "";
  const filePath = readFilePathFromUrl(part.url) ?? (sourcePath || part.filename?.trim() || "");
  if (filePath.length === 0 || !part.mime) {
    return null;
  }

  const name = part.filename?.trim() || basenameForPath(filePath);
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
  part: Extract<ParsedOpencodePart, { type: "file" }>,
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

  const name = part.filename?.trim() || basenameForPath(filePath);
  return {
    kind: "file_reference",
    file: {
      id: part.id,
      path: filePath,
      name,
      kind: detectAgentFileReferenceKind({ filePath, mime: part.mime }),
    },
    sourceText: source.text,
  };
};

type OpenCodeAgentPart = Extract<ParsedOpencodePart, { type: "agent" }>;

const normalizeSubagentReferencePart = (
  part: OpenCodeAgentPart,
): AgentUserMessageDisplayPart | null => {
  const name = part.name.trim();
  if (name.length === 0) {
    return null;
  }
  const subagent: AgentSubagentReference = {
    id: name,
    name,
    label: name,
  };
  const displayPart: AgentUserMessageDisplayPart = {
    kind: "subagent_reference",
    subagent,
  };
  if (part.source) displayPart.sourceText = part.source;
  return displayPart;
};

const isAutoSlashCommandEnvelopeText = (text: string): boolean => {
  return text.startsWith(AUTO_SLASH_COMMAND_OPEN) && text.includes(AUTO_SLASH_COMMAND_CLOSE);
};

export const normalizeUserMessageDisplayParts = (
  parts: ParsedOpencodePart[],
): AgentUserMessageDisplayPart[] => {
  const normalizedParts: AgentUserMessageDisplayPart[] = [];
  let hasAutoSlashCommandEnvelope = false;

  for (const part of parts) {
    if (part.type === "text") {
      if (part.synthetic || part.ignored || part.text.length === 0) {
        continue;
      }

      if (isAutoSlashCommandEnvelopeText(part.text)) {
        if (!hasAutoSlashCommandEnvelope) {
          normalizedParts.push({ kind: "text", text: part.text });
          hasAutoSlashCommandEnvelope = true;
        }
        continue;
      }

      if (!hasAutoSlashCommandEnvelope) {
        normalizedParts.push({ kind: "text", text: part.text });
      }
      continue;
    }

    if (part.type === "file") {
      const fileReference = normalizeFileReferencePart(part);
      if (fileReference) {
        normalizedParts.push(fileReference);
      }
      continue;
    }

    if (part.type === "agent") {
      const subagentReference = normalizeSubagentReferencePart(part);
      if (subagentReference) {
        normalizedParts.push(subagentReference);
      }
    }
  }

  return normalizedParts;
};

const hasVisibleUserTextDisplayPart = (parts: AgentUserMessageDisplayPart[]): boolean => {
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

    if (part.kind === "file_reference") {
      return [{ kind: "file_reference", file: part.file }];
    }

    if (part.kind === "subagent_reference") {
      return [{ kind: "subagent_reference", subagent: part.subagent }];
    }

    return [];
  });

  return buildOpenCodeVisibleText(userMessageParts);
};

export const sanitizeAssistantMessage = (rawMessage: string): string => rawMessage.trim();

type MessageInfoInput = ParsedOpencodeMessage["info"];

export const readMessageModelSelection = (
  info: MessageInfoInput,
): AgentModelSelection | undefined => {
  const providerId = info.role === "user" ? info.model.providerID : info.providerID;
  const modelId = info.role === "user" ? info.model.modelID : info.modelID;
  const variant = info.role === "user" ? info.model.variant : info.variant;

  const selection: AgentModelSelection = {
    providerId,
    modelId,
  };
  if (variant?.trim()) selection.variant = variant;
  if (info.agent.trim()) selection.profileId = info.agent;
  return selection;
};

type TokenBreakdown = Extract<ParsedOpencodePart, { type: "step-finish" }>["tokens"];

const toFiniteNumber = (value: number | undefined): number | null => {
  if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const sumTokenBreakdown = (breakdown: TokenBreakdown): number => {
  const input = toFiniteNumber(breakdown.input) ?? 0;
  const output = toFiniteNumber(breakdown.output) ?? 0;
  const reasoning = toFiniteNumber(breakdown.reasoning) ?? 0;
  const cacheRead = toFiniteNumber(breakdown.cache.read) ?? 0;
  const cacheWrite = toFiniteNumber(breakdown.cache.write) ?? 0;
  return Math.max(0, input + output + reasoning + cacheRead + cacheWrite);
};

export const toTokenTotal = (value: TokenBreakdown): number | undefined => {
  const summed = sumTokenBreakdown(value);
  return summed > 0 ? summed : undefined;
};

export const extractMessageTotalTokens = (
  info: MessageInfoInput,
  parts: readonly ParsedOpencodePart[],
): number | undefined => {
  if (info.role === "assistant") {
    const infoTokens = toTokenTotal(info.tokens);
    if (infoTokens !== undefined) {
      return infoTokens;
    }
  }

  let maxPartTokens = 0;
  for (const part of parts) {
    if (part.type !== "step-finish") {
      continue;
    }
    const partTokens = toTokenTotal(part.tokens);
    if (partTokens !== undefined && partTokens > maxPartTokens) {
      maxPartTokens = partTokens;
    }
  }

  return maxPartTokens > 0 ? maxPartTokens : undefined;
};

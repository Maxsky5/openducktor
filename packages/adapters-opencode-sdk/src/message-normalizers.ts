import type { Part } from "@opencode-ai/sdk/v2/client";
import type {
  AgentFileSearchResultKind,
  AgentModelSelection,
  AgentUserMessageDisplayPart,
  AgentUserMessageSourceText,
} from "@openducktor/core";
import { asUnknownRecord, readRecordProp, readUnknownProp } from "./guards";

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
  try {
    const parsed = new URL(url);
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

const toFileReferenceKind = (
  filePath: string,
  mime: string | undefined,
): AgentFileSearchResultKind => {
  if (mime === "inode/directory") {
    return "directory";
  }

  if (mime?.startsWith("image/")) {
    return "image";
  }

  if (mime?.startsWith("video/")) {
    return "video";
  }

  const normalizedPath = filePath.trim().toLowerCase();
  if (normalizedPath.endsWith(".css")) {
    return "css";
  }
  if (
    normalizedPath.endsWith(".ts") ||
    normalizedPath.endsWith(".tsx") ||
    normalizedPath.endsWith(".mts") ||
    normalizedPath.endsWith(".cts") ||
    normalizedPath.endsWith(".js") ||
    normalizedPath.endsWith(".jsx") ||
    normalizedPath.endsWith(".mjs") ||
    normalizedPath.endsWith(".cjs") ||
    normalizedPath.endsWith(".java") ||
    normalizedPath.endsWith(".kt") ||
    normalizedPath.endsWith(".kts") ||
    normalizedPath.endsWith(".php") ||
    normalizedPath.endsWith(".phtml") ||
    normalizedPath.endsWith(".html") ||
    normalizedPath.endsWith(".htm") ||
    normalizedPath.endsWith(".rs") ||
    normalizedPath.endsWith(".py") ||
    normalizedPath.endsWith(".rb") ||
    normalizedPath.endsWith(".go") ||
    normalizedPath.endsWith(".c") ||
    normalizedPath.endsWith(".h") ||
    normalizedPath.endsWith(".cpp") ||
    normalizedPath.endsWith(".cc") ||
    normalizedPath.endsWith(".cxx") ||
    normalizedPath.endsWith(".hpp") ||
    normalizedPath.endsWith(".cs") ||
    normalizedPath.endsWith(".swift") ||
    normalizedPath.endsWith(".scala") ||
    normalizedPath.endsWith(".sh") ||
    normalizedPath.endsWith(".bash") ||
    normalizedPath.endsWith(".zsh") ||
    normalizedPath.endsWith(".sql") ||
    normalizedPath.endsWith(".json") ||
    normalizedPath.endsWith(".yaml") ||
    normalizedPath.endsWith(".yml") ||
    normalizedPath.endsWith(".toml") ||
    normalizedPath.endsWith(".xml")
  ) {
    return "code";
  }

  if (
    normalizedPath.endsWith(".png") ||
    normalizedPath.endsWith(".jpg") ||
    normalizedPath.endsWith(".jpeg") ||
    normalizedPath.endsWith(".gif") ||
    normalizedPath.endsWith(".webp") ||
    normalizedPath.endsWith(".svg") ||
    normalizedPath.endsWith(".bmp") ||
    normalizedPath.endsWith(".ico") ||
    normalizedPath.endsWith(".avif")
  ) {
    return "image";
  }

  if (
    normalizedPath.endsWith(".mp4") ||
    normalizedPath.endsWith(".mov") ||
    normalizedPath.endsWith(".webm") ||
    normalizedPath.endsWith(".mkv") ||
    normalizedPath.endsWith(".avi") ||
    normalizedPath.endsWith(".m4v")
  ) {
    return "video";
  }
  return "default";
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

const normalizeFileReferencePart = (
  part: Extract<Part, { type: "file" }>,
): AgentUserMessageDisplayPart | null => {
  const source = part.source;
  const sourcePath = source?.type === "file" ? source.path.trim() : "";
  const filePath =
    sourcePath.length > 0
      ? sourcePath
      : (readFilePathFromUrl(part.url) ?? part.filename?.trim() ?? "");
  if (filePath.length === 0) {
    return null;
  }

  const name = part.filename?.trim() || readPathBasename(filePath);
  const sourceText = source?.type === "file" ? normalizeSourceText(source.text) : undefined;
  return {
    kind: "file_reference",
    file: {
      id: part.id,
      path: filePath,
      name,
      kind: toFileReferenceKind(filePath, part.mime),
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
  return parts.some(
    (part) => part.kind === "text" && !part.synthetic && part.text.trim().length > 0,
  );
};

export const ensureVisibleUserTextDisplayParts = (
  parts: AgentUserMessageDisplayPart[],
  fallbackText: string,
): AgentUserMessageDisplayPart[] => {
  const normalizedFallbackText = fallbackText.trim();
  if (hasVisibleUserTextDisplayPart(parts) || normalizedFallbackText.length === 0) {
    return parts;
  }

  return [{ kind: "text", text: normalizedFallbackText }, ...parts];
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
    .join("")
    .trim();
  if (visibleText.length > 0) {
    return visibleText;
  }

  return parts
    .flatMap((part) =>
      part.kind === "file_reference" && part.sourceText?.value
        ? [{ start: part.sourceText.start, value: part.sourceText.value }]
        : [],
    )
    .sort((left, right) => left.start - right.start)
    .map((part) => part.value)
    .join("")
    .trim();
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
  return typeof direct === "string" ? direct.trim() : "";
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

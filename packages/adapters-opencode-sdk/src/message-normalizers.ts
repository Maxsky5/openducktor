import type { Part } from "@opencode-ai/sdk/v2/client";

export const readTextFromParts = (parts: Part[]): string => {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

export const readTextFromMessageInfo = (info: unknown): string => {
  if (!info || typeof info !== "object") {
    return "";
  }
  const record = info as Record<string, unknown>;
  const direct =
    record.text ??
    record.content ??
    (record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>).text
      : undefined);
  return typeof direct === "string" ? direct.trim() : "";
};

export const sanitizeAssistantMessage = (rawMessage: string): string => rawMessage.trim();

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

const toTokenTotal = (value: unknown): number | undefined => {
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
  const infoTokens =
    info && typeof info === "object"
      ? toTokenTotal((info as { tokens?: unknown }).tokens)
      : undefined;
  if (typeof infoTokens === "number" && infoTokens > 0) {
    return infoTokens;
  }

  let maxPartTokens = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const partTokens = toTokenTotal((part as { tokens?: unknown }).tokens);
    if (typeof partTokens === "number" && partTokens > maxPartTokens) {
      maxPartTokens = partTokens;
    }
  }

  return maxPartTokens > 0 ? maxPartTokens : undefined;
};

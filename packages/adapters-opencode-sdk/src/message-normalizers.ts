import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentModelSelection } from "@openducktor/core";
import { asUnknownRecord, readRecordProp, readUnknownProp } from "./guards";

export const readTextFromParts = (parts: Part[]): string => {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
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

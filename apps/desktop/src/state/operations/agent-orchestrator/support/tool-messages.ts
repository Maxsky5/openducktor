import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { isRunningToolStatus } from "../agent-tool-messages";

export const normalizeToolInput = (
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!input) {
    return undefined;
  }
  return Object.keys(input).length > 0 ? input : undefined;
};

export const normalizeToolText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  if (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const resolveToolMessageId = (
  messages: AgentChatMessage[],
  part: {
    messageId: string;
    callId: string;
    tool: string;
    status: "pending" | "running" | "completed" | "error";
  },
  fallbackId: string,
): string => {
  const existingByFallback = messages.find((entry) => entry.id === fallbackId);
  if (existingByFallback) {
    return fallbackId;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || entry.role !== "tool" || entry.meta?.kind !== "tool") {
      continue;
    }
    const meta = entry.meta;
    if (meta.tool !== part.tool || !part.callId) {
      continue;
    }
    if (meta.callId === part.callId) {
      return entry.id;
    }
  }

  if (part.status === "pending" || part.status === "running") {
    return fallbackId;
  }

  let fallbackCandidateId: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || entry.role !== "tool" || entry.meta?.kind !== "tool") {
      continue;
    }
    const meta = entry.meta;
    if (meta.tool !== part.tool) {
      continue;
    }
    if (!isRunningToolStatus(meta.status)) {
      continue;
    }
    if (entry.id.startsWith(`tool:${part.messageId}:`)) {
      return entry.id;
    }
    fallbackCandidateId = fallbackCandidateId ?? entry.id;
  }
  return fallbackCandidateId ?? fallbackId;
};

export const normalizeSessionErrorMessage = (value: string): string => {
  const trimmed = value.trim();
  const withoutQuotes = trimmed
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .trim();

  if (!withoutQuotes.startsWith("{")) {
    return withoutQuotes;
  }

  try {
    const parsed = JSON.parse(withoutQuotes) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return withoutQuotes;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message.trim();
    }
    const nestedError = record.error;
    if (
      nestedError &&
      typeof nestedError === "object" &&
      typeof (nestedError as Record<string, unknown>).message === "string"
    ) {
      return String((nestedError as Record<string, unknown>).message).trim();
    }
    return withoutQuotes;
  } catch {
    return withoutQuotes;
  }
};

const STOP_ABORT_SESSION_ERROR_PATTERN =
  /^(?:aborted|request aborted|operation aborted|the operation was aborted|this operation was aborted|cancel(?:led|ed)|request cancel(?:led|ed)|operation cancel(?:led|ed)|cancel(?:led|ed) by user|request cancel(?:led|ed) by user)$/i;

export const isStopAbortSessionErrorMessage = (value: string): boolean => {
  const normalized = normalizeSessionErrorMessage(value)
    .trim()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ");
  return STOP_ABORT_SESSION_ERROR_PATTERN.test(normalized);
};

export const normalizeRetryStatusMessage = (value: string): string => {
  const normalized = normalizeSessionErrorMessage(value);
  if (!normalized.startsWith("{")) {
    return normalized;
  }

  const messageMatch = normalized.match(/message["':\s]+([^",}]+|"[^"]+")/i);
  if (messageMatch?.[1]) {
    return messageMatch[1].replace(/^"|"$/g, "").trim();
  }
  return normalized;
};

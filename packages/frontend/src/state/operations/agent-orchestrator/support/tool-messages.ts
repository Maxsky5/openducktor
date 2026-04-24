import { isRunningToolStatus } from "../agent-tool-messages";
import {
  findLastToolSessionMessage,
  findSessionMessageById,
  type SessionMessageOwner,
} from "./messages";

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
  session: SessionMessageOwner,
  part: {
    messageId: string;
    callId: string;
    tool: string;
    status: "pending" | "running" | "completed" | "error";
  },
  fallbackId: string,
): string => {
  const existingByFallback = findSessionMessageById(session, fallbackId);
  if (existingByFallback) {
    return fallbackId;
  }

  if (part.callId) {
    const byCallId = findLastToolSessionMessage(
      session,
      (entry) =>
        entry.meta?.kind === "tool" &&
        entry.meta.tool === part.tool &&
        entry.meta.callId === part.callId,
    );
    if (byCallId) {
      return byCallId.id;
    }
  }

  if (part.status === "pending" || part.status === "running") {
    return fallbackId;
  }

  const byMessageScopedFallback = findLastToolSessionMessage(
    session,
    (entry) =>
      entry.meta?.kind === "tool" &&
      entry.meta.tool === part.tool &&
      isRunningToolStatus(entry.meta.status) &&
      entry.id.startsWith(`tool:${part.messageId}:`),
  );
  if (byMessageScopedFallback) {
    return byMessageScopedFallback.id;
  }

  const byRunningTool = findLastToolSessionMessage(
    session,
    (entry) =>
      entry.meta?.kind === "tool" &&
      entry.meta.tool === part.tool &&
      isRunningToolStatus(entry.meta.status),
  );
  return byRunningTool?.id ?? fallbackId;
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

// Keep this intentionally narrow and rely on stop intent as a second gate so
// real runtime failures are not downgraded into user-stopped notices.
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

import type { AgentToolData, AgentToolPart } from "@openducktor/contracts";
import { normalizeSessionErrorMessage } from "../../../lib/session-error-message";
import type { AgentChatMessage } from "../../../types/agent-orchestrator";
import { isRunningToolStatus } from "../agent-tool-messages";
import {
  findLastToolSessionMessage,
  findSessionMessageById,
  type SessionMessageOwner,
} from "./messages";

export const normalizeToolInput = (input: AgentToolData | undefined): AgentToolData | undefined => {
  if (!input) {
    return undefined;
  }
  return Object.keys(input).length > 0 ? input : undefined;
};

export const normalizeToolText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

type ToolMessageMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;

/** The chat message meta of a tool part from history or from a full tool part read. */
export const toToolMessageMeta = (part: AgentToolPart): ToolMessageMeta => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const meta: ToolMessageMeta = {
    kind: "tool",
    partId: part.partId,
    callId: part.callId,
    tool: part.tool,
    toolType: part.toolType,
    status: part.status,
  };
  if (part.inputStreaming !== undefined) meta.inputStreaming = part.inputStreaming;
  if (part.preview) {
    meta.preview = part.preview;
  }
  if (part.title) {
    meta.title = part.title;
  }
  if (part.displayLabel) {
    meta.displayLabel = part.displayLabel;
  }
  if (input) {
    meta.input = input;
  }
  if (output) {
    meta.output = output;
  }
  if (error) {
    meta.error = error;
  }
  if (part.resultContent) meta.resultContent = part.resultContent;
  if (part.fileDiffs) {
    meta.fileDiffs = part.fileDiffs;
  }
  if (part.fileContent) {
    meta.fileContent = part.fileContent;
  }
  if (part.fileChanges) {
    meta.fileChanges = part.fileChanges;
  }
  if (part.computerUse) {
    meta.computerUse = part.computerUse;
  }
  if (part.metadata) {
    meta.metadata = part.metadata;
  }
  if (part.startedAtMs !== undefined) {
    meta.startedAtMs = part.startedAtMs;
  }
  if (part.endedAtMs !== undefined) {
    meta.endedAtMs = part.endedAtMs;
  }
  if (part.detailsOmitted) meta.detailsOmitted = true;
  return meta;
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
    return byCallId?.id ?? fallbackId;
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

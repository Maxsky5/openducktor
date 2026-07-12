import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  forEachSessionMessageFrom,
  getSessionMessageAt,
  getSessionMessageCount,
  isFinalAssistantChatMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

import { isAssistantMessageStreaming } from "./agent-chat-streaming";

export type AgentChatTranscriptRow =
  | {
      kind: "turn_duration";
      key: string;
      durationMs: number;
    }
  | {
      kind: "fork_boundary";
      key: string;
      label: string;
      parentExternalSessionId: string;
    }
  | {
      kind: "message";
      key: string;
      message: AgentChatMessage;
    };

export type AgentChatTurnAnchor = {
  key: string;
  startRow: number;
  endRowExclusive: number;
};

type AgentChatTranscriptMetadata = {
  hasAttachmentMessages: boolean;
  lastUserMessageKey: string | null;
  activeStreamingAssistantMessageId: string | null;
};

export type AgentChatTranscriptModel = AgentChatTranscriptMetadata & {
  rows: AgentChatTranscriptRow[];
  turnAnchors: AgentChatTurnAnchor[];
};

type BuildAgentChatTranscriptModelOptions = {
  showThinkingMessages: boolean;
};

export type AgentChatTranscriptModelBuilder = {
  step: (maxMessages?: number) => number;
  isDone: () => boolean;
  complete: () => AgentChatTranscriptModel;
};

export type AgentChatTranscriptModelPrefixMode = "append" | "replace-tail";

const isVisibleTranscriptMessage = (
  message: AgentChatMessage,
  showThinkingMessages: boolean,
): boolean => message.role !== "thinking" || showThinkingMessages;

const updateAggregateMetadataForMessage = ({
  message,
  isSessionWorking,
  metadata,
}: {
  message: AgentChatMessage;
  isSessionWorking: boolean;
  metadata: AgentChatTranscriptMetadata;
}): void => {
  if (
    !metadata.hasAttachmentMessages &&
    message.meta?.kind === "user" &&
    message.meta.parts?.some((part) => part.kind === "attachment")
  ) {
    metadata.hasAttachmentMessages = true;
  }

  if (isSessionWorking && isAssistantMessageStreaming(message)) {
    metadata.activeStreamingAssistantMessageId = message.id;
  }
};

const appendMessageRows = (
  rows: AgentChatTranscriptRow[],
  sessionKey: string,
  message: AgentChatMessage,
  messageIndex: number,
  showThinkingMessages: boolean,
): string | null => {
  if (message.role === "thinking" && !showThinkingMessages) {
    return null;
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const turnDurationMs = assistantMeta?.durationMs;
  const shouldShowTurnDuration =
    isFinalAssistantChatMessage(message) &&
    typeof turnDurationMs === "number" &&
    turnDurationMs > 0;
  const rowKey = `${sessionKey}:${messageIndex}:${message.id}`;
  const forkBoundaryMeta =
    message.meta?.kind === "session_notice" && message.meta.reason === "session_forked"
      ? message.meta
      : null;

  if (forkBoundaryMeta) {
    rows.push({
      kind: "fork_boundary",
      key: `${rowKey}:fork-boundary`,
      label: forkBoundaryMeta.title,
      parentExternalSessionId: forkBoundaryMeta.parentExternalSessionId,
    });
    return rowKey;
  }

  if (shouldShowTurnDuration) {
    rows.push({
      kind: "turn_duration",
      key: `${rowKey}:duration`,
      durationMs: turnDurationMs,
    });
  }

  rows.push({
    kind: "message",
    key: rowKey,
    message,
  });

  return rowKey;
};

export function createAgentChatTranscriptModelBuilder(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatTranscriptModelOptions,
): AgentChatTranscriptModelBuilder {
  const rows: AgentChatTranscriptRow[] = [];
  const turnRowStartIndexes: number[] = [];
  const sessionKey = agentSessionIdentityKey(session);
  const messageCount = getSessionMessageCount(session);
  const isSessionWorking = isAgentSessionActivityWorking(session.activityState);
  const metadata: AgentChatTranscriptMetadata = {
    hasAttachmentMessages: false,
    lastUserMessageKey: null,
    activeStreamingAssistantMessageId: null,
  };
  let nextMessageIndex = 0;

  const processMessage = (message: AgentChatMessage, messageIndex: number): void => {
    updateAggregateMetadataForMessage({ message, isSessionWorking, metadata });

    if (!isVisibleTranscriptMessage(message, showThinkingMessages)) {
      return;
    }

    const nextRowStart = rows.length;
    const isForkBoundary =
      message.meta?.kind === "session_notice" && message.meta.reason === "session_forked";
    if (nextRowStart === 0 || message.role === "user" || isForkBoundary) {
      turnRowStartIndexes.push(nextRowStart);
    }

    const rowKey = appendMessageRows(rows, sessionKey, message, messageIndex, showThinkingMessages);
    if (message.role === "user") {
      metadata.lastUserMessageKey = rowKey;
    }
  };

  return {
    step(maxMessages = Number.POSITIVE_INFINITY): number {
      let processedCount = 0;
      while (processedCount < maxMessages && nextMessageIndex < messageCount) {
        const message = getSessionMessageAt(session, nextMessageIndex);
        if (message) {
          processMessage(message, nextMessageIndex);
        }
        nextMessageIndex += 1;
        processedCount += 1;
      }
      return processedCount;
    },
    isDone(): boolean {
      return nextMessageIndex >= messageCount;
    },
    complete(): AgentChatTranscriptModel {
      if (nextMessageIndex < messageCount) {
        this.step();
      }

      return {
        rows,
        turnAnchors: turnRowStartIndexes.map((startRow, index) => ({
          key: rows[startRow]?.key ?? `turn-${index}`,
          startRow,
          endRowExclusive: turnRowStartIndexes[index + 1] ?? rows.length,
        })),
        ...metadata,
      };
    },
  };
}

export function buildAgentChatTranscriptModel(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatTranscriptModelOptions,
): AgentChatTranscriptModel {
  return createAgentChatTranscriptModelBuilder(session, { showThinkingMessages }).complete();
}

const findRowIndexForMessage = (rows: AgentChatTranscriptRow[], messageId: string): number => {
  let matchingRowIndex = -1;
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex];
    if (row?.kind === "message" && row.message.id === messageId) {
      if (matchingRowIndex >= 0) {
        return -1;
      }
      matchingRowIndex = rowIndex;
    }
  }

  return matchingRowIndex;
};

const buildMetadataFromRows = (
  rows: AgentChatTranscriptRow[],
  isSessionWorking: boolean,
): AgentChatTranscriptMetadata => {
  const metadata: AgentChatTranscriptMetadata = {
    hasAttachmentMessages: false,
    lastUserMessageKey: null,
    activeStreamingAssistantMessageId: null,
  };

  for (const row of rows) {
    if (row.kind === "message") {
      updateAggregateMetadataForMessage({ message: row.message, isSessionWorking, metadata });
      if (row.message.role === "user") {
        metadata.lastUserMessageKey = row.key;
      }
    }
  }

  return metadata;
};

export const findActiveStreamingAssistantMessageIdInRows = (
  rows: AgentChatTranscriptRow[],
): string | null => {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex];
    if (row?.kind === "message" && isAssistantMessageStreaming(row.message)) {
      return row.message.id;
    }
  }

  return null;
};

// This helper intentionally trusts the caller's incremental safety plan. Use append mode only
// for true tail appends; replace-tail is the only mode allowed to cut by message id.
export function updateAgentChatTranscriptModelFromPrefix({
  session,
  showThinkingMessages,
  previousTranscriptModel,
  startMessageIndex,
  mode,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  previousTranscriptModel: AgentChatTranscriptModel;
  startMessageIndex: number;
  mode: AgentChatTranscriptModelPrefixMode;
}): AgentChatTranscriptModel | null {
  const sessionKey = agentSessionIdentityKey(session);
  const messageCount = getSessionMessageCount(session);
  let firstTailRowIndex = previousTranscriptModel.rows.length;

  if (mode === "replace-tail") {
    for (let messageIndex = startMessageIndex; messageIndex < messageCount; messageIndex += 1) {
      const message = getSessionMessageAt(session, messageIndex);
      if (!message || !isVisibleTranscriptMessage(message, showThinkingMessages)) {
        continue;
      }

      const messageRowIndex = findRowIndexForMessage(previousTranscriptModel.rows, message.id);
      if (messageRowIndex < 0) {
        return null;
      }
      const maybeDurationRowIndex = messageRowIndex - 1;
      const maybeDurationRow = previousTranscriptModel.rows[maybeDurationRowIndex];
      firstTailRowIndex =
        maybeDurationRow?.kind === "turn_duration" &&
        maybeDurationRow.key === `${previousTranscriptModel.rows[messageRowIndex]?.key}:duration`
          ? maybeDurationRowIndex
          : messageRowIndex;
      break;
    }
  }

  const rows = previousTranscriptModel.rows.slice(0, firstTailRowIndex);
  const isSessionWorking = isAgentSessionActivityWorking(session.activityState);
  const metadata = buildMetadataFromRows(rows, isSessionWorking);

  let messageIndex = startMessageIndex;
  forEachSessionMessageFrom(session, startMessageIndex, (message) => {
    const currentMessageIndex = messageIndex;
    messageIndex += 1;
    updateAggregateMetadataForMessage({ message, isSessionWorking, metadata });
    if (!isVisibleTranscriptMessage(message, showThinkingMessages)) {
      return;
    }
    const rowKey = appendMessageRows(
      rows,
      sessionKey,
      message,
      currentMessageIndex,
      showThinkingMessages,
    );
    if (message.role === "user") {
      metadata.lastUserMessageKey = rowKey;
    }
  });

  return {
    rows,
    turnAnchors: buildAgentChatTurnAnchors(rows),
    ...metadata,
  };
}

export function buildAgentChatTurnAnchors(rows: AgentChatTranscriptRow[]): AgentChatTurnAnchor[] {
  if (rows.length === 0) {
    return [];
  }

  const turnStartIndices: number[] = [0];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const startsTurn =
      row?.kind === "fork_boundary" || (row?.kind === "message" && row.message.role === "user");
    if (!startsTurn) {
      continue;
    }

    turnStartIndices.push(rowIndex);
  }

  return turnStartIndices.map((start, index) => ({
    key: rows[start]?.key ?? `turn-${index}`,
    startRow: start,
    endRowExclusive: turnStartIndices[index + 1] ?? rows.length,
  }));
}

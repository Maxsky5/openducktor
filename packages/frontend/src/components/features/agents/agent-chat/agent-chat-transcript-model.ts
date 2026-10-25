import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import {
  forEachSessionMessageFrom,
  getSessionMessageAt,
  getSessionMessageCount,
  isFinalAssistantChatMessage,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { isSessionSystemPromptMessage } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/session-prompt";
import type { AgentChatTranscriptSession } from "./agent-chat.types";

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
      kind: "compaction";
      key: string;
      status: "running" | "completed";
      label: string;
      context: string | null;
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

/** A user message row. Its message section runs up to the next user message row. */
export type AgentChatUserMessageAnchor = {
  rowKey: string;
  rowIndex: number;
  message: AgentChatMessage;
};

type AgentChatTranscriptMetadata = {
  hasAttachmentMessages: boolean;
  lastUserMessageKey: string | null;
  activeStreamingAssistantMessageId: string | null;
};

export type AgentChatTranscriptModel = AgentChatTranscriptMetadata & {
  rows: AgentChatTranscriptRow[];
  turnAnchors: AgentChatTurnAnchor[];
  userMessageAnchors: AgentChatUserMessageAnchor[];
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
  metadata,
}: {
  message: AgentChatMessage;
  metadata: AgentChatTranscriptMetadata;
}): void => {
  if (
    !metadata.hasAttachmentMessages &&
    (message.meta?.kind === "image_generation" ||
      (message.meta?.kind === "user" &&
        message.meta.parts?.some((part) => part.kind === "attachment")))
  ) {
    metadata.hasAttachmentMessages = true;
  }

  if (isAssistantMessageStreaming(message)) {
    metadata.activeStreamingAssistantMessageId = message.id;
  }
};

const appendMessageRows = (
  rows: AgentChatTranscriptRow[],
  sessionKey: string,
  message: AgentChatMessage,
  occurrence: number,
  showThinkingMessages: boolean,
): string | null => {
  if (message.role === "thinking" && !showThinkingMessages) {
    return null;
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const turnDurationMs = assistantMeta?.durationMs;
  const shouldShowTurnDuration =
    isFinalAssistantChatMessage(message) && turnDurationMs !== undefined && turnDurationMs > 0;
  const rowKey = `${sessionKey}:${encodeURIComponent(message.id)}:${occurrence}`;
  const notice = message.meta?.kind === "session_notice" ? message.meta : null;

  if (notice?.reason === "session_compacted") {
    const status = notice.compactionStatus === "running" ? "running" : "completed";
    const context = status === "completed" ? notice.summary?.trim() || null : null;
    rows.push({
      kind: "compaction",
      key: `${rowKey}:compaction`,
      status,
      label: context ? "Compacted" : message.content.trim() || "Compacted",
      context,
    });
    return rowKey;
  }

  if (notice?.reason === "session_forked") {
    rows.push({
      kind: "fork_boundary",
      key: `${rowKey}:fork-boundary`,
      label: notice.title,
      parentExternalSessionId: notice.parentExternalSessionId,
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

  if (
    message.role === "assistant" &&
    message.meta?.kind === "assistant" &&
    message.content.length === 0
  ) {
    return rowKey;
  }

  rows.push({
    kind: "message",
    key: rowKey,
    message,
  });

  return rowKey;
};

const placeInitialSystemPrompt = (rows: AgentChatTranscriptRow[]): AgentChatTranscriptRow[] => {
  const initialPrompt = rows.find(
    (row) => row.kind === "message" && isSessionSystemPromptMessage(row.message),
  );
  if (!initialPrompt) return rows;
  const visible = rows.filter(
    (row) => row.kind !== "message" || !isSessionSystemPromptMessage(row.message),
  );
  const firstUser = visible.findIndex(
    (row) => row.kind === "message" && row.message.role === "user",
  );
  visible.splice(firstUser < 0 ? 0 : firstUser, 0, initialPrompt);
  return visible;
};

export function createAgentChatTranscriptModelBuilder(
  session: AgentChatTranscriptSession,
  { showThinkingMessages }: BuildAgentChatTranscriptModelOptions,
): AgentChatTranscriptModelBuilder {
  const rows: AgentChatTranscriptRow[] = [];
  const sessionKey = agentSessionIdentityKey(session);
  const messageCount = getSessionMessageCount(session);
  const metadata: AgentChatTranscriptMetadata = {
    hasAttachmentMessages: false,
    lastUserMessageKey: null,
    activeStreamingAssistantMessageId: null,
  };
  let nextMessageIndex = 0;
  const occurrences = new Map<string, number>();

  const processMessage = (message: AgentChatMessage): void => {
    updateAggregateMetadataForMessage({ message, metadata });
    const occurrence = occurrences.get(message.id) ?? 0;
    occurrences.set(message.id, occurrence + 1);

    if (!isVisibleTranscriptMessage(message, showThinkingMessages)) {
      return;
    }

    const rowKey = appendMessageRows(rows, sessionKey, message, occurrence, showThinkingMessages);
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
          processMessage(message);
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

      const visibleRows = placeInitialSystemPrompt(rows);
      return {
        rows: visibleRows,
        turnAnchors: buildAgentChatTurnAnchors(visibleRows),
        userMessageAnchors: buildAgentChatUserMessageAnchors(visibleRows),
        ...metadata,
      };
    },
  };
}

export function buildAgentChatTranscriptModel(
  session: AgentChatTranscriptSession,
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

const buildMetadataFromRows = (rows: AgentChatTranscriptRow[]): AgentChatTranscriptMetadata => {
  const metadata: AgentChatTranscriptMetadata = {
    hasAttachmentMessages: false,
    lastUserMessageKey: null,
    activeStreamingAssistantMessageId: null,
  };

  for (const row of rows) {
    if (row.kind === "message") {
      updateAggregateMetadataForMessage({ message: row.message, metadata });
      if (row.message.role === "user") {
        metadata.lastUserMessageKey = row.key;
      }
    }
  }

  return metadata;
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
  session: AgentChatTranscriptSession;
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
  const metadata = buildMetadataFromRows(rows);

  const occurrences = new Map<string, number>();
  forEachSessionMessageFrom(session, startMessageIndex, (message) => {
    occurrences.set(message.id, 0);
  });
  for (let index = 0; index < startMessageIndex; index += 1) {
    const message = getSessionMessageAt(session, index);
    if (!message) continue;
    const occurrence = occurrences.get(message.id);
    if (occurrence !== undefined) occurrences.set(message.id, occurrence + 1);
  }
  forEachSessionMessageFrom(session, startMessageIndex, (message) => {
    const occurrence = occurrences.get(message.id) ?? 0;
    occurrences.set(message.id, occurrence + 1);
    updateAggregateMetadataForMessage({ message, metadata });
    if (!isVisibleTranscriptMessage(message, showThinkingMessages)) {
      return;
    }
    const rowKey = appendMessageRows(rows, sessionKey, message, occurrence, showThinkingMessages);
    if (message.role === "user") {
      metadata.lastUserMessageKey = rowKey;
    }
  });

  const visibleRows = placeInitialSystemPrompt(rows);
  return {
    rows: visibleRows,
    turnAnchors: buildAgentChatTurnAnchors(visibleRows),
    userMessageAnchors: buildAgentChatUserMessageAnchors(
      visibleRows,
      previousTranscriptModel.userMessageAnchors,
    ),
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

/**
 * Lists the user message rows. A streaming update usually keeps every user message, so this
 * returns the previous list when nothing changed, and the readers of the list do not render again.
 */
export function buildAgentChatUserMessageAnchors(
  rows: AgentChatTranscriptRow[],
  previous: AgentChatUserMessageAnchor[] = [],
): AgentChatUserMessageAnchor[] {
  const anchors: AgentChatUserMessageAnchor[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row?.kind === "message" && row.message.role === "user") {
      anchors.push({ rowKey: row.key, rowIndex, message: row.message });
    }
  }

  const isUnchanged =
    anchors.length === previous.length &&
    anchors.every((anchor, index) => {
      const previousAnchor = previous[index];
      return (
        previousAnchor?.rowKey === anchor.rowKey &&
        previousAnchor.rowIndex === anchor.rowIndex &&
        previousAnchor.message === anchor.message
      );
    });
  return isUnchanged ? previous : anchors;
}

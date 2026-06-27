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

/** Initial number of user turns rendered from the bottom of the transcript. */
export const CHAT_TURN_WINDOW_INIT = 10;
/** Number of older user turns revealed per upward backfill step. */
export const CHAT_TURN_WINDOW_BATCH = 8;

export type AgentChatWindowRow =
  | {
      kind: "turn_duration";
      key: string;
      durationMs: number;
    }
  | {
      kind: "message";
      key: string;
      message: AgentChatMessage;
    };

export type AgentChatWindowTurn = {
  key: string;
  start: number;
  end: number;
};

type AgentChatWindowAggregateMetadata = {
  hasAttachmentMessages: boolean;
  lastUserMessageId: string | null;
  activeStreamingAssistantMessageId: string | null;
};

export type AgentChatWindowRowsState = AgentChatWindowAggregateMetadata & {
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
};

type BuildAgentChatWindowRowsOptions = {
  showThinkingMessages: boolean;
};

export type AgentChatWindowRowsStateBuilder = {
  step: (maxMessages?: number) => number;
  isDone: () => boolean;
  complete: () => AgentChatWindowRowsState;
};

export type AgentChatWindowRowsPrefixMode = "append" | "replace-tail";

export const isStreamingAssistantMessage = (message: AgentChatMessage): boolean =>
  message.role === "assistant" &&
  message.meta?.kind === "assistant" &&
  message.meta.isFinal === false;

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
  metadata: AgentChatWindowAggregateMetadata;
}): void => {
  if (
    !metadata.hasAttachmentMessages &&
    message.meta?.kind === "user" &&
    message.meta.parts?.some((part) => part.kind === "attachment")
  ) {
    metadata.hasAttachmentMessages = true;
  }

  if (message.role === "user") {
    metadata.lastUserMessageId = message.id;
  }

  if (isSessionWorking && isStreamingAssistantMessage(message)) {
    metadata.activeStreamingAssistantMessageId = message.id;
  }
};

const appendMessageRows = (
  rows: AgentChatWindowRow[],
  sessionKey: string,
  message: AgentChatMessage,
  showThinkingMessages: boolean,
): void => {
  if (message.role === "thinking" && !showThinkingMessages) {
    return;
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const turnDurationMs = assistantMeta?.durationMs;
  const shouldShowTurnDuration =
    isFinalAssistantChatMessage(message) &&
    typeof turnDurationMs === "number" &&
    turnDurationMs > 0;

  if (shouldShowTurnDuration) {
    rows.push({
      kind: "turn_duration",
      key: `${sessionKey}:${message.id}:duration`,
      durationMs: turnDurationMs,
    });
  }

  rows.push({
    kind: "message",
    key: `${sessionKey}:${message.id}`,
    message,
  });
};

export function createAgentChatWindowRowsStateBuilder(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsStateBuilder {
  const rows: AgentChatWindowRow[] = [];
  const turnRowStartIndexes: number[] = [];
  const sessionKey = agentSessionIdentityKey(session);
  const messageCount = getSessionMessageCount(session);
  const isSessionWorking = isAgentSessionActivityWorking(session.activityState);
  const metadata: AgentChatWindowAggregateMetadata = {
    hasAttachmentMessages: false,
    lastUserMessageId: null,
    activeStreamingAssistantMessageId: null,
  };
  let nextMessageIndex = 0;

  const processMessage = (message: AgentChatMessage): void => {
    updateAggregateMetadataForMessage({ message, isSessionWorking, metadata });

    if (!isVisibleTranscriptMessage(message, showThinkingMessages)) {
      return;
    }

    const nextRowStart = rows.length;
    if (nextRowStart === 0 || message.role === "user") {
      turnRowStartIndexes.push(nextRowStart);
    }

    appendMessageRows(rows, sessionKey, message, showThinkingMessages);
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
    complete(): AgentChatWindowRowsState {
      if (nextMessageIndex < messageCount) {
        this.step();
      }

      return {
        rows,
        turns: turnRowStartIndexes.map((start, index) => ({
          key: rows[start]?.key ?? `turn-${index}`,
          start,
          end: (turnRowStartIndexes[index + 1] ?? rows.length) - 1,
        })),
        ...metadata,
      };
    },
  };
}

export function buildAgentChatWindowRowsState(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsState {
  return createAgentChatWindowRowsStateBuilder(session, { showThinkingMessages }).complete();
}

const findRowIndexForMessage = (rows: AgentChatWindowRow[], messageId: string): number => {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex];
    if (row?.kind === "message" && row.message.id === messageId) {
      return rowIndex;
    }
  }

  return -1;
};

export const findActiveStreamingAssistantMessageId = (
  rows: AgentChatWindowRow[],
): string | null => {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex];
    if (row?.kind === "message" && isStreamingAssistantMessage(row.message)) {
      return row.message.id;
    }
  }

  return null;
};

// This helper intentionally trusts the caller's incremental safety plan. Use append mode only
// for true tail appends; replace-tail is the only mode allowed to cut by message id.
export function buildAgentChatWindowRowsStateFromPrefix({
  session,
  showThinkingMessages,
  previousRowsState,
  startMessageIndex,
  mode,
}: {
  session: AgentChatThreadSession;
  showThinkingMessages: boolean;
  previousRowsState: AgentChatWindowRowsState;
  startMessageIndex: number;
  mode: AgentChatWindowRowsPrefixMode;
}): AgentChatWindowRowsState {
  const sessionKey = agentSessionIdentityKey(session);
  const messageCount = getSessionMessageCount(session);
  let firstTailRowIndex = previousRowsState.rows.length;

  if (mode === "replace-tail") {
    for (let messageIndex = startMessageIndex; messageIndex < messageCount; messageIndex += 1) {
      const message = getSessionMessageAt(session, messageIndex);
      if (!message || !isVisibleTranscriptMessage(message, showThinkingMessages)) {
        continue;
      }

      const messageRowIndex = findRowIndexForMessage(previousRowsState.rows, message.id);
      if (messageRowIndex >= 0) {
        const maybeDurationRowIndex = messageRowIndex - 1;
        const maybeDurationRow = previousRowsState.rows[maybeDurationRowIndex];
        firstTailRowIndex =
          maybeDurationRow?.kind === "turn_duration" &&
          maybeDurationRow.key === `${sessionKey}:${message.id}:duration`
            ? maybeDurationRowIndex
            : messageRowIndex;
      }
      break;
    }
  }

  const rows = previousRowsState.rows.slice(0, firstTailRowIndex);
  const isSessionWorking = isAgentSessionActivityWorking(session.activityState);
  const metadata: AgentChatWindowAggregateMetadata = {
    hasAttachmentMessages: previousRowsState.hasAttachmentMessages,
    lastUserMessageId: previousRowsState.lastUserMessageId,
    activeStreamingAssistantMessageId: isSessionWorking
      ? findActiveStreamingAssistantMessageId(rows)
      : null,
  };

  forEachSessionMessageFrom(session, startMessageIndex, (message) => {
    updateAggregateMetadataForMessage({ message, isSessionWorking, metadata });
    appendMessageRows(rows, sessionKey, message, showThinkingMessages);
  });

  return {
    rows,
    turns: buildAgentChatWindowTurns(rows),
    ...metadata,
  };
}

export function buildAgentChatWindowRows(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRow[] {
  return buildAgentChatWindowRowsState(session, { showThinkingMessages }).rows;
}

export function buildAgentChatWindowTurns(rows: AgentChatWindowRow[]): AgentChatWindowTurn[] {
  if (rows.length === 0) {
    return [];
  }

  const turnStartIndices: number[] = [0];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    turnStartIndices.push(rowIndex);
  }

  return turnStartIndices.map((start, index) => ({
    key: rows[start]?.key ?? `turn-${index}`,
    start,
    end: (turnStartIndices[index + 1] ?? rows.length) - 1,
  }));
}

export function getAgentChatInitialTurnStart(turnCount: number): number {
  return turnCount > CHAT_TURN_WINDOW_INIT ? turnCount - CHAT_TURN_WINDOW_INIT : 0;
}

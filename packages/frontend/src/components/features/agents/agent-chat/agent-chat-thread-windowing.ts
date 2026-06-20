import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
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
  let hasAttachmentMessages = false;
  let lastUserMessageId: string | null = null;
  let activeStreamingAssistantMessageId: string | null = null;
  let nextMessageIndex = 0;

  const processMessage = (message: AgentChatMessage): void => {
    const isVisibleMessage = !(message.role === "thinking" && !showThinkingMessages);

    if (
      !hasAttachmentMessages &&
      message.meta?.kind === "user" &&
      message.meta.parts?.some((part) => part.kind === "attachment")
    ) {
      hasAttachmentMessages = true;
    }

    if (message.role === "user") {
      lastUserMessageId = message.id;
    }

    if (
      isSessionWorking &&
      message.role === "assistant" &&
      message.meta?.kind === "assistant" &&
      message.meta.isFinal === false
    ) {
      activeStreamingAssistantMessageId = message.id;
    }

    if (!isVisibleMessage) {
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
        hasAttachmentMessages,
        lastUserMessageId,
        activeStreamingAssistantMessageId,
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

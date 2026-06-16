import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  forEachSessionMessage,
  isFinalAssistantChatMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";
import { resolveActiveStreamingAssistantMessageId } from "./agent-chat-streaming";

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

const appendMessageRows = (
  rows: AgentChatWindowRow[],
  sessionKey: string,
  message: AgentChatMessage,
): void => {
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

export function buildAgentChatWindowRowsState(
  session: AgentChatThreadSession,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsState {
  const rows: AgentChatWindowRow[] = [];
  const turnRowStartIndexes: number[] = [];
  const sessionKey = agentSessionIdentityKey(session);
  let hasAttachmentMessages = false;
  let lastUserMessageId: string | null = null;
  const activeStreamingAssistantMessageId = resolveActiveStreamingAssistantMessageId(session);

  forEachSessionMessage(session, (message) => {
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

    if (!isVisibleMessage) {
      return;
    }

    const nextRowStart = rows.length;
    if (nextRowStart === 0 || message.role === "user") {
      turnRowStartIndexes.push(nextRowStart);
    }

    appendMessageRows(rows, sessionKey, message);
  });

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

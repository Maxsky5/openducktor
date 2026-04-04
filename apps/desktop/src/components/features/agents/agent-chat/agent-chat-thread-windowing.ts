import {
  findFirstChangedSessionMessageIndex,
  forEachSessionMessage,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

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
  rows: AgentChatWindowRow[];
};

type BuildAgentChatWindowRowsOptions = {
  showThinkingMessages: boolean;
};

export type AgentChatWindowRowsState = {
  rows: AgentChatWindowRow[];
  rowStartByMessageIndex: number[];
  rebuildStartByMessageIndex: number[];
  latestRebuildStartMessageIndex: number;
  turns: AgentChatWindowTurn[];
};

const appendMessageRows = (
  rows: AgentChatWindowRow[],
  rowStartByMessageIndex: number[],
  sessionId: string,
  message: AgentChatMessage,
  messageIndex: number,
  showThinkingMessages: boolean,
): void => {
  rowStartByMessageIndex[messageIndex] = rows.length;

  if (message.role === "thinking" && !showThinkingMessages) {
    return;
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const turnDurationMs = assistantMeta?.durationMs;
  const shouldShowTurnDuration =
    message.role === "assistant" &&
    assistantMeta?.isFinal === true &&
    typeof turnDurationMs === "number" &&
    turnDurationMs > 0;

  if (shouldShowTurnDuration) {
    rows.push({
      kind: "turn_duration",
      // Scope row identity to the active session to avoid cross-session cache reuse.
      key: `${sessionId}:${message.id}:duration`,
      durationMs: turnDurationMs,
    });
  }

  rows.push({
    kind: "message",
    // Message IDs can repeat across sessions; include session ID for stable row keys.
    key: `${sessionId}:${message.id}`,
    message,
  });
};

export function buildAgentChatWindowRowsState(
  session: AgentSessionState,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRowsState {
  const rows: AgentChatWindowRow[] = [];
  const rowStartByMessageIndex: number[] = [];
  const rebuildStartByMessageIndex: number[] = [];
  const turnStartIndices: number[] = [];
  let currentRebuildStartMessageIndex = 0;
  let hasVisibleMessages = false;

  forEachSessionMessage(session, (message, messageIndex) => {
    const isVisibleMessage = !(message.role === "thinking" && !showThinkingMessages);

    if (isVisibleMessage) {
      if (!hasVisibleMessages) {
        currentRebuildStartMessageIndex = messageIndex;
        hasVisibleMessages = true;
      }

      if (message.role === "user") {
        currentRebuildStartMessageIndex = messageIndex;
      }
    }

    rebuildStartByMessageIndex[messageIndex] = currentRebuildStartMessageIndex;

    if (!isVisibleMessage) {
      rowStartByMessageIndex[messageIndex] = rows.length;
      return;
    }

    const nextRowStart = rows.length;
    if (nextRowStart === 0 || message.role === "user") {
      turnStartIndices.push(nextRowStart);
    }

    appendMessageRows(
      rows,
      rowStartByMessageIndex,
      session.sessionId,
      message,
      messageIndex,
      showThinkingMessages,
    );
  });

  return {
    rows,
    rowStartByMessageIndex,
    rebuildStartByMessageIndex,
    latestRebuildStartMessageIndex: currentRebuildStartMessageIndex,
    turns: turnStartIndices.map((start, index) => ({
      key: rows[start]?.key ?? `turn-${index}`,
      start,
      end: (turnStartIndices[index + 1] ?? rows.length) - 1,
      rows: rows.slice(start, turnStartIndices[index + 1] ?? rows.length),
    })),
  };
}

export function buildAgentChatWindowRows(
  session: AgentSessionState,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRow[] {
  return buildAgentChatWindowRowsState(session, { showThinkingMessages }).rows;
}

export function findFirstChangedChatMessageIndex(
  previousMessages: AgentSessionState["messages"] | null,
  nextSession: Pick<AgentSessionState, "sessionId" | "messages">,
): number {
  return findFirstChangedSessionMessageIndex(previousMessages, nextSession);
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
    rows: rows.slice(start, turnStartIndices[index + 1] ?? rows.length),
  }));
}

export function getAgentChatInitialTurnStart(turnCount: number): number {
  return turnCount > CHAT_TURN_WINDOW_INIT ? turnCount - CHAT_TURN_WINDOW_INIT : 0;
}

export function getAgentChatWindowRowsKey(
  session: AgentSessionState,
  showThinkingMessages: boolean,
  resolveMessageIdentityToken: (message: AgentChatMessage) => number,
): string {
  const signatureParts: string[] = [
    session.sessionId,
    showThinkingMessages ? "thinking:on" : "thinking:off",
  ];

  forEachSessionMessage(session, (message) => {
    const assistantDurationToken =
      message.meta?.kind === "assistant" && typeof message.meta.durationMs === "number"
        ? String(message.meta.durationMs)
        : "";
    signatureParts.push(
      String(resolveMessageIdentityToken(message)),
      message.id,
      message.role,
      assistantDurationToken,
    );
  });

  return signatureParts.join("\u001f");
}

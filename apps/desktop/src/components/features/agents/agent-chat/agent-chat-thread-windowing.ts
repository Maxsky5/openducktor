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

type BuildAgentChatWindowRowsOptions = {
  showThinkingMessages: boolean;
};

export function buildAgentChatWindowRows(
  session: AgentSessionState,
  { showThinkingMessages }: BuildAgentChatWindowRowsOptions,
): AgentChatWindowRow[] {
  const rows: AgentChatWindowRow[] = [];

  for (const message of session.messages) {
    if (message.role === "thinking" && !showThinkingMessages) {
      continue;
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
        key: `${session.sessionId}:${message.id}:duration`,
        durationMs: turnDurationMs,
      });
    }

    rows.push({
      kind: "message",
      // Message IDs can repeat across sessions; include session ID for stable row keys.
      key: `${session.sessionId}:${message.id}`,
      message,
    });
  }

  return rows;
}

export type AgentChatWindowTurn = {
  key: string;
  start: number;
  end: number;
};

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

export function getAgentChatWindowRowsKey(
  session: AgentSessionState,
  showThinkingMessages: boolean,
  resolveMessageIdentityToken: (message: AgentChatMessage) => number,
): string {
  const signatureParts: string[] = [
    session.sessionId,
    session.status,
    showThinkingMessages ? "thinking:on" : "thinking:off",
    session.draftReasoningText,
    session.draftReasoningMessageId ?? "",
    String(session.pendingQuestions.length),
  ];

  for (const message of session.messages) {
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
  }

  return signatureParts.join("\u001f");
}

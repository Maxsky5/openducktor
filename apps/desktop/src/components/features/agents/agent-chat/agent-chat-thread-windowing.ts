import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

/** Maximum messages in the rendered sliding window. */
export const CHAT_WINDOW_SIZE = 50;
/** Extra messages rendered above/below the viewport for smooth scrolling. */
export const CHAT_OVERSCAN = 10;
/** Number of messages shifted when a sentinel is triggered. Keep this smaller than overscan for tall rows. */
export const CHAT_SHIFT_SIZE = 5;

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

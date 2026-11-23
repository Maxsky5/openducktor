import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionTurnRecord } from "../../ports/agent-session-turn-store-port";
import { turnMatchesMessage } from "../../domain/agent-session-message-fingerprint";

type HistoryEntry = AgentSessionHistoryMessage;

const isStopNotice = (entry: HistoryEntry): boolean =>
  entry.role === "system" && entry.notice?.reason === "session_interrupted";

const toStopNotice = (turn: AgentSessionTurnRecord): HistoryEntry | null =>
  turn.end?.interruption
    ? {
        messageId: turn.end.interruption.messageId,
        role: "system",
        timestamp: turn.end.completedAt,
        text: turn.end.interruption.message,
        notice: { tone: "cancelled", reason: "session_interrupted", title: "Interrupted" },
        parts: [],
      }
    : null;

const withTurn = (
  entry: HistoryEntry,
  turn: AgentSessionTurnRecord,
  exposesCompletionState: boolean,
): HistoryEntry => {
  if (!entry.timestampIsApproximate) return entry;
  if (entry.role === "user") {
    const { timestampIsApproximate: _approximate, ...exact } = entry;
    const user = { ...exact, timestamp: turn.startedAt };
    if (!user.model && turn.model) user.model = turn.model;
    return user;
  }
  if (entry.role !== "assistant") return entry;
  const end = turn.end;
  if (end && entry.messageId === end.finalMessageId) {
    const { timestampIsApproximate: _approximate, ...exact } = entry;
    const final = { ...exact, timestamp: end.completedAt };
    if (!final.model && turn.model) final.model = turn.model;
    if (final.durationMs === undefined && end.durationMs !== undefined) {
      final.durationMs = end.durationMs;
    }
    return final;
  }
  // A history without completion state marks the last reply of each turn final. Only a
  // completed run has a final reply.
  const parts =
    !exposesCompletionState && end && end.outcome !== "completed"
      ? entry.parts.filter((part) => part.kind !== "step")
      : entry.parts;
  return { ...entry, timestamp: turn.startedAt, parts };
};

/**
 * Adds the turn facts that the host saved while the session was live where the runtime history
 * lacks them: exact times, the model, the duration, and the stop notice. Entries with exact times
 * stay as the runtime reports them. A saved turn applies only when its user message text still
 * matches.
 */
export const applySavedTurns = (
  history: readonly HistoryEntry[],
  turns: readonly AgentSessionTurnRecord[],
  exposesCompletionState: boolean,
): HistoryEntry[] => {
  if (turns.length === 0) return [...history];
  const byUserMessageId = new Map(turns.map((turn) => [turn.userMessageId, turn]));
  const merged: HistoryEntry[] = [];
  let current: AgentSessionTurnRecord | null = null;
  let hasStopNotice = false;
  const closeTurn = () => {
    const notice = current && !hasStopNotice ? toStopNotice(current) : null;
    if (notice) merged.push(notice);
  };
  for (const entry of history) {
    if (entry.role === "user") {
      closeTurn();
      const turn = byUserMessageId.get(entry.messageId);
      current = turn && turnMatchesMessage(turn, entry.text) ? turn : null;
      hasStopNotice = false;
    }
    if (isStopNotice(entry)) hasStopNotice = true;
    merged.push(current ? withTurn(entry, current, exposesCompletionState) : entry);
  }
  closeTurn();
  return merged;
};

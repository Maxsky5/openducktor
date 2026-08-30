import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { CodexThreadHistoryReadResponse } from "./types";

const CODEX_FORK_BOUNDARY_TITLE = "Session forked here";

export type CodexForkBoundary = {
  childThreadId: string;
  parentThreadId: string;
  beforeTurnId: string | null;
  beforeTurnIndex: number;
  timestamp: string;
};

const threadFromReadResponse = (
  response: CodexThreadHistoryReadResponse | undefined,
): CodexThreadHistoryReadResponse["thread"] => {
  if (!response) {
    throw new Error("Codex thread/read response is missing thread data for fork projection.");
  }
  return response.thread;
};

export const codexForkedFromThreadId = (
  response: CodexThreadHistoryReadResponse | undefined,
): string | null => {
  const thread = threadFromReadResponse(response);
  return "forkedFromId" in thread ? thread.forkedFromId : null;
};

export const codexForkHistoryIsChildOwned = (
  response: CodexThreadHistoryReadResponse | undefined,
): boolean => {
  const thread = threadFromReadResponse(response);
  const turns = thread.turns;
  if (turns.length === 0) {
    return true;
  }
  if (!("createdAt" in thread) || !Number.isFinite(thread.createdAt)) {
    return false;
  }
  return turns.every(
    (turn) =>
      turn.startedAt !== null &&
      Number.isFinite(turn.startedAt) &&
      turn.startedAt > thread.createdAt,
  );
};

const timestampFromSeconds = (value: number | null | undefined, context: string): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`Codex ${context} is missing a valid timestamp.`);
  }
  return new Date(value * 1000).toISOString();
};

export const resolveCodexForkBoundary = (
  response: CodexThreadHistoryReadResponse | undefined,
  parentTurnIds: ReadonlySet<string>,
): CodexForkBoundary | null => {
  const thread = threadFromReadResponse(response);
  const childThreadId = thread.id;
  const parentThreadId = "forkedFromId" in thread ? thread.forkedFromId : null;
  if (!parentThreadId) {
    return null;
  }
  const declaredParentThreadId = "parentThreadId" in thread ? thread.parentThreadId : null;
  if (declaredParentThreadId && declaredParentThreadId !== parentThreadId) {
    throw new Error(
      `Codex child thread '${childThreadId}' was forked from '${parentThreadId}' but declares parent '${declaredParentThreadId}'.`,
    );
  }
  const turns = thread.turns;
  const turnIds = turns.map((turn) => turn.id);
  const firstChildOwnedTurnIndex = turnIds.findIndex((turnId) => !parentTurnIds.has(turnId));
  const beforeTurnIndex = firstChildOwnedTurnIndex >= 0 ? firstChildOwnedTurnIndex : turnIds.length;
  for (let index = beforeTurnIndex; index < turnIds.length; index += 1) {
    const turnId = turnIds[index];
    if (turnId && parentTurnIds.has(turnId)) {
      throw new Error(
        `Codex child thread '${childThreadId}' has non-contiguous inherited turns around '${turnId}'.`,
      );
    }
  }
  const firstChildOwnedTurn = turns[beforeTurnIndex];
  const threadCreatedAt = "createdAt" in thread ? thread.createdAt : undefined;
  const timestamp = firstChildOwnedTurn
    ? timestampFromSeconds(
        firstChildOwnedTurn.startedAt ?? threadCreatedAt,
        `child turn '${turnIds[beforeTurnIndex]}'`,
      )
    : timestampFromSeconds(threadCreatedAt, `child thread '${childThreadId}'`);
  return {
    childThreadId,
    parentThreadId,
    beforeTurnId: turnIds[beforeTurnIndex] ?? null,
    beforeTurnIndex,
    timestamp,
  };
};

export const codexForkBoundaryHistoryMessage = (
  boundary: CodexForkBoundary,
): AgentSessionHistoryMessage => ({
  messageId: `codex-fork-boundary:${boundary.childThreadId}`,
  role: "system",
  timestamp: boundary.timestamp,
  text: CODEX_FORK_BOUNDARY_TITLE,
  notice: {
    tone: "info",
    reason: "session_forked",
    title: CODEX_FORK_BOUNDARY_TITLE,
    parentExternalSessionId: boundary.parentThreadId,
  },
  parts: [],
});

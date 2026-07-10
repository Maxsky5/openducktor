import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { arrayFromUnknown, extractStringField, isPlainObject } from "./codex-app-server-shared";

const CODEX_FORK_BOUNDARY_TITLE = "Session forked here";

export type CodexForkBoundary = {
  childThreadId: string;
  parentThreadId: string;
  beforeTurnId: string | null;
  beforeTurnIndex: number;
  timestamp: string;
};

const threadFromReadResponse = (response: unknown): Record<string, unknown> => {
  if (!isPlainObject(response) || !isPlainObject(response.thread)) {
    throw new Error("Codex thread/read response is missing thread data for fork projection.");
  }
  return response.thread;
};

export const codexForkedFromThreadId = (response: unknown): string | null => {
  const thread = threadFromReadResponse(response);
  return extractStringField(thread, ["forkedFromId", "forked_from_id"]);
};

const timestampFromSeconds = (value: unknown, context: string): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Codex ${context} is missing a valid timestamp.`);
  }
  return new Date(value * 1000).toISOString();
};

export const resolveCodexForkBoundary = (
  response: unknown,
  parentTurnIds: ReadonlySet<string>,
): CodexForkBoundary | null => {
  const thread = threadFromReadResponse(response);
  const childThreadId = extractStringField(thread, ["id"]);
  if (!childThreadId) {
    throw new Error("Codex forked thread/read response is missing the child thread id.");
  }
  const parentThreadId = extractStringField(thread, ["forkedFromId", "forked_from_id"]);
  if (!parentThreadId) {
    return null;
  }
  const declaredParentThreadId = extractStringField(thread, ["parentThreadId", "parent_thread_id"]);
  if (declaredParentThreadId && declaredParentThreadId !== parentThreadId) {
    throw new Error(
      `Codex child thread '${childThreadId}' was forked from '${parentThreadId}' but declares parent '${declaredParentThreadId}'.`,
    );
  }
  const turns = arrayFromUnknown(thread.turns);
  const turnIds = turns.map((turn, index) => {
    const turnId = extractStringField(turn, ["id", "turnId", "turn_id"]);
    if (!turnId) {
      throw new Error(
        `Codex child thread '${childThreadId}' has a forked turn without an id at index ${index}.`,
      );
    }
    return turnId;
  });
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
  if (turnIds.length > 0 && beforeTurnIndex === 0 && parentTurnIds.size > 0) {
    throw new Error(
      `Codex child thread '${childThreadId}' declares fork parent '${parentThreadId}' but shares no parent turn ids.`,
    );
  }
  const firstChildOwnedTurn = turns[beforeTurnIndex];
  const timestamp = firstChildOwnedTurn
    ? timestampFromSeconds(
        isPlainObject(firstChildOwnedTurn)
          ? (firstChildOwnedTurn.startedAt ?? firstChildOwnedTurn.started_at)
          : undefined,
        `child turn '${turnIds[beforeTurnIndex]}'`,
      )
    : timestampFromSeconds(
        thread.createdAt ?? thread.created_at,
        `child thread '${childThreadId}'`,
      );
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
  messageId: `codex-fork-boundary:${boundary.childThreadId}:${boundary.beforeTurnId ?? "tail"}`,
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

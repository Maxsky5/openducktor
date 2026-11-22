import { Effect } from "effect";
import type {
  AgentSessionTurnRecord,
  AgentSessionTurnStorePort,
} from "./agent-session-turn-store-port";

/** A turn store in memory, in the same form as the host database store. */
export const createMemoryAgentSessionTurnStore = () => {
  const turns = new Map<string, AgentSessionTurnRecord>();
  const key = (input: { runtimeKind: string; externalSessionId: string; userMessageId: string }) =>
    `${input.runtimeKind}:${input.externalSessionId}:${input.userMessageId}`;
  const store: AgentSessionTurnStorePort = {
    recordTurnStart: ({ workspaceId: _workspaceId, ...start }) =>
      Effect.sync(() => {
        if (!turns.has(key(start))) turns.set(key(start), start);
      }),
    recordTurnEnd: (end) =>
      Effect.sync(() => {
        const existing = turns.get(key(end));
        if (existing) turns.set(key(end), { ...existing, ...end });
      }),
    listTurns: (session) =>
      Effect.sync(() =>
        [...turns.values()]
          .filter(
            (turn) =>
              turn.runtimeKind === session.runtimeKind &&
              turn.externalSessionId === session.externalSessionId,
          )
          .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt)),
      ),
  };
  return { store, turns };
};

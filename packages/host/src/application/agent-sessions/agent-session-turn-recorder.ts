import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { agentSessionMessageFingerprint } from "../../domain/agent-session-message-fingerprint";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";
import type { AgentSessionTurnStorePort } from "../../ports/agent-session-turn-store-port";

/** The open run of a session: its first message time, its last message, and its final reply. */
type OpenRun = {
  readonly startedAt: number;
  lastUserMessageId: string;
  finalMessageId?: string | undefined;
  finalAt?: number | undefined;
  /** The user messages of the run that the host saved, so a repeated event saves nothing. */
  readonly saved: Set<string>;
};

/**
 * Saves each turn from the ordered live stream of every runtime: the accepted user message at
 * its start, and the end of the run on its last user message. Baselines replay old events, so they
 * save nothing.
 */
export const createAgentSessionTurnRecorder = ({
  store,
  readWorkspaceId,
}: {
  store: AgentSessionTurnStorePort;
  readWorkspaceId(ref: AgentSessionLiveRef): Effect.Effect<string | null, HostError>;
}): AgentSessionPersistencePort => {
  const runs = new Map<string, OpenRun>();
  return {
    observe: (envelope, provenance) =>
      Effect.gen(function* () {
        if (envelope.type === "session_removed") {
          runs.delete(agentSessionRefKey(envelope.ref));
          return;
        }
        if (envelope.type !== "transcript_event" || provenance === "baseline") return;
        const event = envelope.event;
        const ref = event.sessionRef;
        const key = agentSessionRefKey(ref);
        const run = runs.get(key);
        const at = Date.parse(event.timestamp);
        switch (event.type) {
          case "user_message": {
            if (run?.saved.has(event.messageId)) return;
            const workspaceId = yield* readWorkspaceId(ref);
            if (!workspaceId) return;
            yield* store.recordTurnStart({
              runtimeKind: ref.runtimeKind,
              externalSessionId: ref.externalSessionId,
              workspaceId,
              userMessageId: event.messageId,
              userMessageHash: agentSessionMessageFingerprint(event.message),
              startedAt: event.timestamp,
              model: event.model,
            });
            if (run) {
              run.lastUserMessageId = event.messageId;
              run.saved.add(event.messageId);
            } else {
              runs.set(key, {
                startedAt: at,
                lastUserMessageId: event.messageId,
                saved: new Set([event.messageId]),
              });
            }
            return;
          }
          case "assistant_message":
            if (!run) return;
            run.finalMessageId = event.messageId;
            run.finalAt = at;
            return;
          case "transcript_retracted":
            if (run?.finalMessageId && event.messageIds.includes(run.finalMessageId)) {
              run.finalMessageId = undefined;
              run.finalAt = undefined;
            }
            return;
          case "session_turn_finished":
          case "session_idle": {
            if (!run || event.turnOutcome === undefined) return;
            runs.delete(key);
            const completedAt = run.finalAt ?? at;
            yield* store.recordTurnEnd({
              runtimeKind: ref.runtimeKind,
              externalSessionId: ref.externalSessionId,
              userMessageId: run.lastUserMessageId,
              completedAt: new Date(completedAt).toISOString(),
              outcome: event.turnOutcome,
              durationMs: Math.max(0, completedAt - run.startedAt),
              finalMessageId: event.turnOutcome === "completed" ? run.finalMessageId : undefined,
              interruption: event.type === "session_idle" ? event.interruption : undefined,
            });
            return;
          }
          default:
            return;
        }
      }),
  };
};

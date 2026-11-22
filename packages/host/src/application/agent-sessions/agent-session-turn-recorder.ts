import type { AgentSessionLiveRef, AgentSessionTranscriptEvent } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { agentSessionMessageFingerprint } from "../../domain/agent-session-message-fingerprint";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionTurnStorePort } from "../../ports/agent-session-turn-store-port";
import { type FinalReply, retractFinalReply, withFinalReply } from "./agent-session-final-reply";

type UserMessage = Extract<AgentSessionTranscriptEvent, { type: "user_message" }>;

/** The open run of a session: its first message time, its last message, and its final reply. */
type OpenRun = {
  readonly startedAt: number;
  lastUserMessageId: string;
  finalReply?: FinalReply | undefined;
  /** The user messages of the run that the host saved, so a repeated event saves nothing. */
  readonly saved: Set<string>;
};

export type AgentSessionTurnRecorder = {
  /** Saves the turn of an accepted user message. A session with no open workspace saves none. */
  start(message: UserMessage, workspaceId: string | null): Effect.Effect<void, HostError>;
  /** Follows the final reply of the run, and saves the end of the run on its last user message. */
  observe(event: AgentSessionTranscriptEvent): Effect.Effect<void, HostError>;
  forget(ref: AgentSessionLiveRef): void;
};

/**
 * Saves each turn from the ordered live stream of every runtime: the accepted user message at its
 * start, and the end of the run on its last user message.
 */
export const createAgentSessionTurnRecorder = (
  store: AgentSessionTurnStorePort,
): AgentSessionTurnRecorder => {
  const runs = new Map<string, OpenRun>();
  return {
    start: (message, workspaceId) =>
      Effect.gen(function* () {
        const ref = message.sessionRef;
        const key = agentSessionRefKey(ref);
        const run = runs.get(key);
        if (!workspaceId || run?.saved.has(message.messageId)) return;
        yield* store.recordTurnStart({
          runtimeKind: ref.runtimeKind,
          externalSessionId: ref.externalSessionId,
          workspaceId,
          userMessageId: message.messageId,
          userMessageHash: agentSessionMessageFingerprint(message.message),
          startedAt: message.timestamp,
          model: message.model,
        });
        if (run) {
          run.lastUserMessageId = message.messageId;
          run.saved.add(message.messageId);
        } else {
          runs.set(key, {
            startedAt: Date.parse(message.timestamp),
            lastUserMessageId: message.messageId,
            saved: new Set([message.messageId]),
          });
        }
      }),
    observe: (event) =>
      Effect.gen(function* () {
        const ref = event.sessionRef;
        const key = agentSessionRefKey(ref);
        const run = runs.get(key);
        if (!run) return;
        const at = Date.parse(event.timestamp);
        switch (event.type) {
          case "assistant_message":
            run.finalReply = withFinalReply(run.finalReply, event.messageId, at);
            return;
          case "transcript_retracted":
            run.finalReply = retractFinalReply(run.finalReply, event.messageIds);
            return;
          case "session_turn_finished":
          case "session_idle": {
            if (event.turnOutcome === undefined) return;
            runs.delete(key);
            const completedAt = run.finalReply?.at ?? at;
            yield* store.recordTurnEnd(
              {
                runtimeKind: ref.runtimeKind,
                externalSessionId: ref.externalSessionId,
                userMessageId: run.lastUserMessageId,
              },
              {
                completedAt: new Date(completedAt).toISOString(),
                outcome: event.turnOutcome,
                durationMs: Math.max(0, completedAt - run.startedAt),
                finalMessageId:
                  event.turnOutcome === "completed" ? run.finalReply?.messageId : undefined,
                interruption: event.type === "session_idle" ? event.interruption : undefined,
              },
            );
            return;
          }
          default:
            return;
        }
      }),
    forget: (ref) => {
      runs.delete(agentSessionRefKey(ref));
    },
  };
};

import type {
  AcceptedAgentUserMessage,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import { agentSessionRefKey, BLOCKED_ON_INPUT_REASON } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import { type QueuePause, SESSION_LEFT_RUNTIME_REASON } from "./agent-message-queue-model";
import { hasForegroundTurn, hasBlockingInput } from "./session-foreground-readiness";

/** A live change that matters to the queue of its session. */
export type QueueSignal =
  | { readonly kind: "pause"; readonly ref: AgentSessionLiveRef; readonly pause: QueuePause }
  | { readonly kind: "turn_completed"; readonly ref: AgentSessionLiveRef }
  | {
      readonly kind: "user_message";
      readonly ref: AgentSessionLiveRef;
      readonly acceptedMessage: AcceptedAgentUserMessage;
    }
  | { readonly kind: "delivery_ready"; readonly sessionKey: string };

/**
 * Tracks foreground work, blocking input, unavailable status, and runtime membership.
 * Background work does not stop a new turn when the runtime reports foreground readiness.
 */
export const createSessionConditions = () => {
  const working = new Set<string>();
  const blockedOnInput = new Set<string>();
  const leftRuntime = new Set<string>();
  const unavailable = new Set<string>();
  const canDeliver = (key: string) =>
    !working.has(key) && !blockedOnInput.has(key) && !leftRuntime.has(key) && !unavailable.has(key);
  return {
    isWorking: (sessionKey: string) => working.has(sessionKey),
    canDeliver,
    isBlockedOnInput: (sessionKey: string) => blockedOnInput.has(sessionKey),
    /** Applies one live change and returns what it means for the queue of its session. */
    observe: (envelope: AgentSessionLiveEnvelope): QueueSignal | null => {
      if (envelope.type === "session_upsert") {
        const key = agentSessionRefKey(envelope.session.ref);
        const wasReady = canDeliver(key);
        leftRuntime.delete(key);
        if (envelope.session.statusUnavailableReason) unavailable.add(key);
        else unavailable.delete(key);
        if (hasForegroundTurn(envelope.session)) working.add(key);
        else working.delete(key);
        if (hasBlockingInput(envelope.session)) {
          blockedOnInput.add(key);
          return null;
        }
        blockedOnInput.delete(key);
        return !wasReady && canDeliver(key) ? { kind: "delivery_ready", sessionKey: key } : null;
      }
      if (envelope.type === "fault" && envelope.statusUnavailable && envelope.ref) {
        unavailable.add(agentSessionRefKey(envelope.ref));
        return null;
      }
      const left = sessionLeftRuntime(envelope);
      if (left) {
        const key = agentSessionRefKey(left);
        working.delete(key);
        if (envelope.type === "session_removed") blockedOnInput.delete(key);
        leftRuntime.add(key);
        return { kind: "pause", ref: left, pause: { cause: "left_runtime" } };
      }
      return envelope.type === "transcript_event" ? transcriptSignal(envelope.event) : null;
    },
    /** Explains what the user must resolve before Resume can release the queue. */
    resumeBlocker: (sessionKey: string): string | null => {
      if (blockedOnInput.has(sessionKey)) return BLOCKED_ON_INPUT_REASON;
      return leftRuntime.has(sessionKey) ? SESSION_LEFT_RUNTIME_REASON : null;
    },
  };
};

/** A snapshot reports each of its sessions like an upsert. */
export const sessionChanges = (envelope: AgentSessionLiveEnvelope): AgentSessionLiveEnvelope[] =>
  envelope.type === "snapshot"
    ? envelope.sessions.map((session) => ({ type: "session_upsert", session }))
    : [envelope];

export const blockedOnInputError = () =>
  new HostValidationError({ field: "session", message: BLOCKED_ON_INPUT_REASON });

const sessionLeftRuntime = (envelope: AgentSessionLiveEnvelope): AgentSessionLiveRef | null => {
  if (envelope.type === "session_removed") return envelope.ref;
  if (envelope.type === "transcript_event" && envelope.event.type === "session_finished") {
    return envelope.event.sessionRef;
  }
  return null;
};

/** Only a turn that completed normally releases the next message. Other turn ends pause. */
const transcriptSignal = (
  event: Extract<AgentSessionLiveEnvelope, { type: "transcript_event" }>["event"],
): QueueSignal | null => {
  const ref = event.sessionRef;
  switch (event.type) {
    case "turn_error":
    case "session_error":
      return { kind: "pause", ref, pause: { cause: "agent_error", detail: event.message } };
    case "user_message":
      return { kind: "user_message", ref, acceptedMessage: event };
    case "session_idle":
    case "session_turn_finished":
      if (event.turnOutcome === "completed") return { kind: "turn_completed", ref };
      if (event.turnOutcome === "interrupted") {
        return { kind: "pause", ref, pause: { cause: "turn_interrupted" } };
      }
      if (event.turnOutcome === "failed") {
        return { kind: "pause", ref, pause: { cause: "turn_failed" } };
      }
      return null;
    default:
      return null;
  }
};

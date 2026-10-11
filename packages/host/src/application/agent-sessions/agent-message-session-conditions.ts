import type {
  AcceptedAgentUserMessage,
  AgentSessionActivity,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import {
  agentSessionRefKey,
  BLOCKED_ON_INPUT_REASON,
  isAgentSessionBlockedOnInput,
} from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import { type QueuePause, SESSION_LEFT_RUNTIME_REASON } from "./agent-message-queue-model";

/** A live change that matters to the queue of its session. */
export type QueueSignal =
  | { readonly kind: "pause"; readonly ref: AgentSessionLiveRef; readonly pause: QueuePause }
  | { readonly kind: "turn_completed"; readonly ref: AgentSessionLiveRef }
  | {
      readonly kind: "user_message";
      readonly ref: AgentSessionLiveRef;
      readonly acceptedMessage: AcceptedAgentUserMessage;
    }
  | { readonly kind: "input_answered"; readonly sessionKey: string };

/**
 * Tracks the live conditions that stop delivery to a session: running work, pending blocking
 * input, and a session that left its runtime. Each live session snapshot replaces all three.
 */
export const createSessionConditions = () => {
  const working = new Set<string>();
  const blockedOnInput = new Set<string>();
  const leftRuntime = new Set<string>();
  return {
    isWorking: (sessionKey: string) => working.has(sessionKey),
    isBlockedOnInput: (sessionKey: string) => blockedOnInput.has(sessionKey),
    /** Applies one live change and returns what it means for the queue of its session. */
    observe: (envelope: AgentSessionLiveEnvelope): QueueSignal | null => {
      if (envelope.type === "session_upsert") {
        const key = agentSessionRefKey(envelope.session.ref);
        leftRuntime.delete(key);
        if (WORKING_ACTIVITIES.has(envelope.session.activity)) working.add(key);
        else working.delete(key);
        const wasBlocked = blockedOnInput.has(key);
        if (isAgentSessionBlockedOnInput(envelope.session)) {
          blockedOnInput.add(key);
          return null;
        }
        blockedOnInput.delete(key);
        return wasBlocked ? { kind: "input_answered", sessionKey: key } : null;
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

const WORKING_ACTIVITIES = new Set<AgentSessionActivity>(["running", "retrying"]);

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

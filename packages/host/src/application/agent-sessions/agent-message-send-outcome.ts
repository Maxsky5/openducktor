import type { AcceptedAgentInput } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import {
  AgentSessionAcceptanceUnknownError,
  AgentSessionBusyError,
  AgentSessionCommandAcceptedError,
  AgentSessionMessageAcceptedError,
  messageAcceptedFailure,
} from "../../ports/agent-session-send-error";
import { SessionOperationError } from "../../ports/session-operation-error";

/** What one send did with a message. Each queue path reads this instead of the error classes. */
export type SendOutcome =
  | { readonly kind: "accepted"; readonly acceptedMessage: AcceptedAgentInput }
  /** The runtime refused a new turn while work runs. Nothing reached it. */
  | { readonly kind: "busy"; readonly error: HostError }
  /** The runtime gave no conclusive answer, so nobody may send the message again. */
  | { readonly kind: "unknown"; readonly error: HostError; readonly messageId?: string }
  /** The runtime took the message, but a later host step failed. */
  | {
      readonly kind: "accepted_then_failed";
      readonly error: AgentSessionMessageAcceptedError | AgentSessionCommandAcceptedError;
    }
  | { readonly kind: "refused"; readonly error: HostError };

/** Native acceptance can arrive after failure classification, before the queue changes. */
export const reconcileAcceptedOutcome = (outcome: SendOutcome): SendOutcome => {
  if (
    outcome.kind === "accepted" ||
    outcome.kind === "accepted_then_failed" ||
    !(outcome.error instanceof SessionOperationError)
  )
    return outcome;
  const { error } = outcome;
  const accepted = error.observation.acceptedInput;
  if (!accepted) return outcome;
  return {
    kind: "accepted_then_failed",
    error: messageAcceptedFailure(error.observation.ref, accepted, "record_message")(error),
  };
};

/** Runs a send and classifies its result. The outcome is never a failure. */
export const sendOutcome = (
  send: Effect.Effect<AcceptedAgentInput, HostError>,
): Effect.Effect<SendOutcome> =>
  Effect.match(send, {
    onSuccess: (acceptedMessage): SendOutcome => ({ kind: "accepted", acceptedMessage }),
    onFailure: (error): SendOutcome => {
      if (error instanceof SessionOperationError) {
        const cause = error.cause;
        if (
          cause instanceof AgentSessionMessageAcceptedError ||
          cause instanceof AgentSessionCommandAcceptedError
        )
          return { kind: "accepted_then_failed", error: cause };
        if (cause instanceof AgentSessionBusyError) return { kind: "busy", error };
        if (cause instanceof AgentSessionAcceptanceUnknownError)
          return { kind: "unknown", error, messageId: cause.messageId };
        if (error.observation.nativeOutcome === "uncertain") return { kind: "unknown", error };
      }
      if (error instanceof AgentSessionBusyError) return { kind: "busy", error };
      if (error instanceof AgentSessionAcceptanceUnknownError)
        return { kind: "unknown", error, messageId: error.messageId };
      if (
        error instanceof AgentSessionMessageAcceptedError ||
        error instanceof AgentSessionCommandAcceptedError
      ) {
        return { kind: "accepted_then_failed", error };
      }
      return { kind: "refused", error };
    },
  }).pipe(Effect.map(reconcileAcceptedOutcome));

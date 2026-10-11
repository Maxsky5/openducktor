import type { AcceptedAgentInput } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import {
  AgentSessionAcceptanceUnknownError,
  AgentSessionBusyError,
  AgentSessionCommandAcceptedError,
  AgentSessionMessageAcceptedError,
} from "../../ports/agent-session-send-error";

/** What one send did with a message. Each queue path reads this instead of the error classes. */
export type SendOutcome =
  | { readonly kind: "accepted"; readonly acceptedMessage: AcceptedAgentInput }
  /** The runtime refused a new turn while work runs. Nothing reached it. */
  | { readonly kind: "busy"; readonly error: AgentSessionBusyError }
  /** The runtime gave no conclusive answer, so nobody may send the message again. */
  | { readonly kind: "unknown"; readonly error: AgentSessionAcceptanceUnknownError }
  /** The runtime took the message, but a later host step failed. */
  | {
      readonly kind: "accepted_then_failed";
      readonly error: AgentSessionMessageAcceptedError | AgentSessionCommandAcceptedError;
    }
  | { readonly kind: "refused"; readonly error: HostError };

/** Runs a send and classifies its result. The outcome is never a failure. */
export const sendOutcome = (
  send: Effect.Effect<AcceptedAgentInput, HostError>,
): Effect.Effect<SendOutcome> =>
  Effect.match(send, {
    onSuccess: (acceptedMessage): SendOutcome => ({ kind: "accepted", acceptedMessage }),
    onFailure: (error): SendOutcome => {
      if (error instanceof AgentSessionBusyError) return { kind: "busy", error };
      if (error instanceof AgentSessionAcceptanceUnknownError) return { kind: "unknown", error };
      if (
        error instanceof AgentSessionMessageAcceptedError ||
        error instanceof AgentSessionCommandAcceptedError
      ) {
        return { kind: "accepted_then_failed", error };
      }
      return { kind: "refused", error };
    },
  });

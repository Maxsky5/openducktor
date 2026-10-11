import type {
  AcceptedAgentInput,
  AgentSessionLiveRef,
  HostInvokeFailure,
} from "@openducktor/contracts";
import {
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
} from "@openducktor/core";
import { HostOperationError } from "../effect/host-errors";

type AcceptedMessageFailure = Extract<
  HostInvokeFailure,
  { kind: "agent_session_message_accepted" }
>;

export class AgentSessionMessageAcceptedError extends HostOperationError {
  readonly failure: AcceptedMessageFailure;

  constructor(input: Omit<AcceptedMessageFailure, "kind">, cause: Error) {
    super({
      operation: "agent-session.send-message",
      message: `The runtime accepted the message, but the session update failed. Do not send the message again. ${cause.message}`,
      cause,
    });
    this.failure = { kind: "agent_session_message_accepted", ...input };
  }
}

/**
 * The runtime rejected the message and did not take it as input. The caller can send it again.
 * A timeout or a lost connection does not prove a rejection.
 */
export class AgentSessionMessageRejectedError extends HostOperationError {}

export class AgentSessionCommandAcceptedError extends HostOperationError {
  readonly failure: Extract<HostInvokeFailure, { kind: "agent_session_command_accepted" }>;
  constructor(
    input: Omit<Extract<HostInvokeFailure, { kind: "agent_session_command_accepted" }>, "kind">,
    cause: Error,
  ) {
    super({
      operation: "agent-session.send-command",
      message: `The runtime accepted the command, but the session update failed. Do not send it again. ${cause.message}`,
      cause,
    });
    this.failure = { kind: "agent_session_command_accepted", ...input };
  }
}

const toAgentSessionAcceptedError = (
  input: AgentSessionLiveRef,
  accepted: AcceptedAgentInput,
  stage: AcceptedMessageFailure["stage"],
  cause: Error,
): AgentSessionMessageAcceptedError | AgentSessionCommandAcceptedError => {
  const sessionRef = {
    repoPath: input.repoPath,
    runtimeKind: input.runtimeKind,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
  };
  return accepted.type === "command_accepted"
    ? new AgentSessionCommandAcceptedError({ sessionRef, acceptedCommand: accepted }, cause)
    : new AgentSessionMessageAcceptedError({ sessionRef, acceptedMessage: accepted, stage }, cause);
};

/** Keeps the accepted message when a later host stage fails, so the caller never sends it again. */
export const messageAcceptedFailure =
  (
    sessionRef: AgentSessionLiveRef,
    accepted: AcceptedAgentInput,
    stage: AcceptedMessageFailure["stage"],
  ) =>
  (cause: Error) =>
    toAgentSessionAcceptedError(sessionRef, accepted, stage, cause);

/** The runtime refused a new turn because work still runs, so the message queue keeps it. */
export class AgentSessionBusyError extends AgentSessionMessageRejectedError {
  constructor(input: { readonly message: string; readonly cause: unknown }) {
    super({ operation: "agent-session.send-message", ...input });
  }
}

/**
 * The runtime sent no conclusive answer to a message. A live user message with `messageId`
 * proves that it arrived.
 */
export class AgentSessionAcceptanceUnknownError extends HostOperationError {
  readonly messageId: string;

  constructor(input: {
    readonly message: string;
    readonly messageId: string;
    readonly cause: unknown;
  }) {
    super({ operation: "agent-session.send-message", message: input.message, cause: input.cause });
    this.messageId = input.messageId;
  }
}

/**
 * Turns the delivery failures that a runtime adapter reports into typed host errors at the
 * runtime boundary. It returns null for any other failure.
 */
export const toAgentSessionSendError = (
  cause: unknown,
): AgentSessionMessageRejectedError | AgentSessionAcceptanceUnknownError | null => {
  if (cause instanceof AgentSessionTurnActiveError) {
    return new AgentSessionBusyError({ message: cause.message, cause });
  }
  if (cause instanceof AgentSessionMessageRefusedError) {
    // The native cause keeps the runtime failure details for the caller.
    return new AgentSessionMessageRejectedError({
      operation: "agent-session.send-message",
      message: cause.message,
      cause: cause.cause,
    });
  }
  if (cause instanceof AgentSessionMessageAcceptanceUnknownError) {
    return new AgentSessionAcceptanceUnknownError({
      message: cause.message,
      messageId: cause.messageId,
      cause,
    });
  }
  return null;
};

import type {
  AcceptedAgentInput,
  AgentSessionLiveRef,
  HostInvokeFailure,
} from "@openducktor/contracts";
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
  cause: Error,
): HostOperationError => {
  const sessionRef = {
    repoPath: input.repoPath,
    runtimeKind: input.runtimeKind,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
  };
  return accepted.type === "command_accepted"
    ? new AgentSessionCommandAcceptedError({ sessionRef, acceptedCommand: accepted }, cause)
    : new AgentSessionMessageAcceptedError(
        { sessionRef, acceptedMessage: accepted, stage: "live_update" },
        cause,
      );
};

export const messageAcceptedFailure =
  (sessionRef: AgentSessionLiveRef, accepted: AcceptedAgentInput) => (cause: Error) =>
    toAgentSessionAcceptedError(sessionRef, accepted, cause);

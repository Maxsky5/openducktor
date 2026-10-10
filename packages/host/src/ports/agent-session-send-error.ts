import type {
  HostInvokeFailure,
  AgentSessionLiveRef,
  AcceptedAgentUserMessage,
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

export const messageAcceptedFailure =
  (sessionRef: AgentSessionLiveRef, acceptedMessage: AcceptedAgentUserMessage) => (cause: Error) =>
    new AgentSessionMessageAcceptedError(
      {
        sessionRef: {
          repoPath: sessionRef.repoPath,
          runtimeKind: sessionRef.runtimeKind,
          workingDirectory: sessionRef.workingDirectory,
          externalSessionId: sessionRef.externalSessionId,
        },
        acceptedMessage,
        stage: "live_update",
      },
      cause,
    );

import type {
  HostInvokeFailure,
  AgentSessionLiveRef,
  AcceptedAgentUserMessage,
} from "@openducktor/contracts";
import { type HostError, HostOperationError } from "../effect/host-errors";

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

/** The runtime did not accept this message. */
export class AgentSessionMessageRejectedError extends HostOperationError {}

export const messageSubmissionRejected = (operation: string) => (cause: HostError) =>
  new AgentSessionMessageRejectedError({ operation, message: cause.message, cause });

export const messageAcceptedFailure =
  (sessionRef: AgentSessionLiveRef, acceptedMessage: AcceptedAgentUserMessage) =>
  (cause: HostError) =>
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

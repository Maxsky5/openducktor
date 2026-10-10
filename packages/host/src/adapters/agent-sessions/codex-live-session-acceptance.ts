import {
  CodexMessageAcceptedError,
  type CodexLiveSessionMutation,
} from "@openducktor/adapters-codex-app-server";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { AcceptedAgentUserMessage } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
  messageAcceptedFailure,
} from "../../ports/agent-session-send-error";
import { CodexAppServerRpcError } from "../../ports/codex-app-server-port";

type RefreshProjection = (
  transcriptEvents?: CodexLiveSessionMutation["transcriptEvents"],
) => Effect.Effect<void, HostError>;

/**
 * Maps a Codex send failure that proves the message result: accepted before the owner was
 * released, or rejected with a JSON-RPC error. It returns null for other failures, such as a
 * timeout or a lost connection, so the caller keeps its session error.
 */
export const toCodexMessageSendError = (
  cause: unknown,
  sessionRef: AgentSessionLiveRef,
): AgentSessionMessageAcceptedError | AgentSessionMessageRejectedError | null => {
  if (cause instanceof CodexMessageAcceptedError)
    return messageAcceptedFailure(sessionRef, cause.acceptedMessage)(cause);
  if (cause instanceof CodexAppServerRpcError)
    return new AgentSessionMessageRejectedError({
      operation: "agent-session.send-message",
      message: cause.message,
      cause,
    });
  return null;
};

const refreshAcceptedCodexMessage = (
  acceptedMessage: AcceptedAgentUserMessage,
  sessionRef: AgentSessionLiveRef,
  refreshProjection: RefreshProjection,
  transcriptEvents?: CodexLiveSessionMutation["transcriptEvents"],
): Effect.Effect<AcceptedAgentUserMessage, HostError> =>
  refreshProjection(transcriptEvents).pipe(
    Effect.as(acceptedMessage),
    Effect.mapError(
      (cause) =>
        new AgentSessionMessageAcceptedError(
          { sessionRef, acceptedMessage, stage: "live_update" },
          cause,
        ),
    ),
  );

export const publishAcceptedCodexMessage = (
  acceptedMessage: AcceptedAgentUserMessage,
  sessionRef: AgentSessionLiveRef,
  refreshProjection: RefreshProjection,
): Effect.Effect<AcceptedAgentUserMessage, HostError> =>
  refreshAcceptedCodexMessage(acceptedMessage, sessionRef, refreshProjection, [
    { ...acceptedMessage, sessionRef },
  ]);

export const refreshAfterAcceptedCodexMessage = (
  acceptedMessage: AcceptedAgentUserMessage,
  sessionRef: AgentSessionLiveRef,
  refreshProjection: RefreshProjection,
): Effect.Effect<AcceptedAgentUserMessage, HostError> =>
  refreshAcceptedCodexMessage(acceptedMessage, sessionRef, refreshProjection);

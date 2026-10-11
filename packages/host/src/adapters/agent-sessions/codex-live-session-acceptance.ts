import {
  CodexMessageAcceptedError,
  type CodexLiveSessionMutation,
} from "@openducktor/adapters-codex-app-server";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { AcceptedAgentUserMessage } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import {
  type AgentSessionAcceptanceUnknownError,
  type AgentSessionCommandAcceptedError,
  AgentSessionMessageAcceptedError,
  type AgentSessionMessageRejectedError,
  messageAcceptedFailure,
  toAgentSessionSendError,
} from "../../ports/agent-session-send-error";

type RefreshProjection = (
  transcriptEvents?: CodexLiveSessionMutation["transcriptEvents"],
) => Effect.Effect<void, HostError>;

/**
 * Maps every Codex send failure that tells the message result: accepted before a later failure,
 * refused, refused because work runs, or unknown. It returns null for other failures, so the
 * caller keeps its session error.
 */
export const toCodexMessageSendError = (
  cause: unknown,
  sessionRef: AgentSessionLiveRef,
):
  | AgentSessionMessageAcceptedError
  | AgentSessionCommandAcceptedError
  | AgentSessionMessageRejectedError
  | AgentSessionAcceptanceUnknownError
  | null =>
  cause instanceof CodexMessageAcceptedError
    ? messageAcceptedFailure(sessionRef, cause.acceptedMessage, "live_update")(cause)
    : toAgentSessionSendError(cause);

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

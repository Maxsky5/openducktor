import type { CodexLiveSessionMutation } from "@openducktor/adapters-codex-app-server";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { AcceptedAgentUserMessage } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import { AgentSessionMessageAcceptedError } from "../../ports/agent-session-send-error";

type RefreshProjection = (
  transcriptEvents?: CodexLiveSessionMutation["transcriptEvents"],
) => Effect.Effect<void, HostError>;

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

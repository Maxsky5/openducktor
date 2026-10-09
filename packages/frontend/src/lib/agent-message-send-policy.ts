import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { RuntimeReadinessSnapshot } from "./runtime-readiness";
import { isAgentSessionBlockedOnInput } from "./agent-session-waiting-input";
import { matchesAgentSessionIdentity } from "./agent-session-identity";
import { deriveLoadedAgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

export const getBusyAgentMessageBlockedReason = (
  isWorking: boolean,
  runtime: RuntimeDescriptor | null,
): string | null =>
  isWorking && !runtime?.capabilities.sessionLifecycle.supportsQueuedUserMessages
    ? `${runtime?.label ?? "The selected runtime"} does not support queued messages while the session is working. Wait for the current turn to finish.`
    : null;

/** Shared submission rules. Scope adapters validate saved recipients separately. */
export const getAgentMessageSendBlockedReason = (input: {
  session: AgentSessionState | null;
  runtime: RuntimeDescriptor | null;
  readiness: RuntimeReadinessSnapshot;
  readModel: AgentSessionReadModelLoadState;
  readOnlyReason: string | null;
  pending: boolean;
  isDraft?: boolean;
  allowStarting?: boolean;
}): string | null => {
  if (input.pending) return "Wait for the current send or session change to finish.";
  if (input.readModel.kind === "failed")
    return `Session data failed to load: ${input.readModel.message} Reload session data and try again.`;
  if (input.readModel.kind !== "ready") return "Wait for session data to load.";
  if (input.readiness.state !== "ready")
    return (
      input.readiness.message ?? "The selected runtime is unavailable. Select Recheck in the chat."
    );
  if (input.readOnlyReason) return input.readOnlyReason;
  if (!input.runtime) return "The selected runtime is unavailable. Recheck runtime settings.";
  if (!input.session)
    return input.isDraft
      ? null
      : "The selected session is missing. Reload session data or restore the chat.";
  if (input.session.runtimeAvailability === "missing")
    return "The selected runtime session is unavailable. Restore the runtime and reload the chat.";
  const transcriptState = deriveLoadedAgentSessionTranscriptState({
    session: input.session,
    runtimeReadinessState: input.readiness.state,
  });
  if (transcriptState.kind === "failed")
    return "Session history failed to load. Retry loading the transcript before sending.";
  if (transcriptState.kind !== "visible") return "Wait for the session transcript to load.";
  if (isAgentSessionBlockedOnInput(input.session))
    return "Answer or reject the blocking approval or question before sending a message.";
  if (input.session.status === "starting" && !input.allowStarting)
    return "Wait for the session to finish starting.";
  return getBusyAgentMessageBlockedReason(input.session.status === "running", input.runtime);
};

/** Registration can precede the first live episode. Bind once, then reject later episodes. */
export const createAgentMessageStartOwner = (start: AgentSessionState) => {
  let episode = start.executionEpisodeId;
  return (session: AgentSessionState): boolean => {
    if (!matchesAgentSessionIdentity(session, start)) return false;
    episode ??= session.executionEpisodeId;
    return session.executionEpisodeId === episode;
  };
};

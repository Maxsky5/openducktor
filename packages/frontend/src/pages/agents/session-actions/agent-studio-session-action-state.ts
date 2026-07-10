import type { RuntimeDescriptor } from "@openducktor/contracts";
import { runtimeSupportsCapability } from "@/lib/agent-runtime";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import type { AgentStudioSelectedSessionState } from "../selected-session/selected-session-state";

type AgentStudioSessionActionStateArgs = {
  selectedSession: AgentStudioSelectedSessionState;
  runtimeDefinitions: RuntimeDescriptor[];
};

export type AgentStudioSessionActionState = {
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  canQueueBusyFollowups: boolean;
  busySendBlockedReason: string | null;
};

export function deriveAgentStudioSessionActionState({
  selectedSession,
  runtimeDefinitions,
}: AgentStudioSessionActionStateArgs): AgentStudioSessionActionState {
  const selectedRuntimeKind = selectedSession.identity?.runtimeKind ?? null;
  const currentRuntimeDescriptor =
    runtimeDefinitions.find((runtime) => runtime.kind === selectedRuntimeKind) ?? null;
  const selectedRuntimeDescriptor =
    currentRuntimeDescriptor ?? selectedSession.runtimeData.modelCatalog?.runtime ?? null;
  const supportsQueuedUserMessages = selectedRuntimeDescriptor
    ? runtimeSupportsCapability(
        selectedRuntimeDescriptor,
        "sessionLifecycle.supportsQueuedUserMessages",
      )
    : false;
  const isSessionWorking = isAgentSessionActivityWorking(selectedSession.activityState);
  const isWaitingInput = selectedSession.activityState === "waiting_input";
  const canQueueBusyFollowups = isSessionWorking && supportsQueuedUserMessages;
  const selectedRuntimeLabel =
    selectedRuntimeDescriptor?.label ?? selectedRuntimeKind ?? "Current runtime";
  const busySendBlockedReason =
    selectedSession.identity !== null && isSessionWorking && !supportsQueuedUserMessages
      ? `${selectedRuntimeLabel} does not support queued messages while the session is working.`
      : null;

  return {
    isSessionWorking,
    isWaitingInput,
    canQueueBusyFollowups,
    busySendBlockedReason,
  };
}

import type { RuntimeDescriptor } from "@openducktor/contracts";
import { runtimeSupportsCapability } from "@/lib/agent-runtime";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@/types/selected-session-runtime-data";

type AgentStudioSessionActionStateArgs = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedSessionActivityState: AgentSessionActivityState | null;
  sessionRuntimeData: SelectedSessionRuntimeData;
  runtimeDefinitions: RuntimeDescriptor[];
};

export type AgentStudioSessionActionState = {
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  canQueueBusyFollowups: boolean;
  busySendBlockedReason: string | null;
};

export function deriveAgentStudioSessionActionState({
  selectedSessionIdentity,
  selectedSessionActivityState,
  sessionRuntimeData,
  runtimeDefinitions,
}: AgentStudioSessionActionStateArgs): AgentStudioSessionActionState {
  const selectedRuntimeKind = selectedSessionIdentity?.runtimeKind ?? null;
  const selectedRuntimeDescriptor =
    sessionRuntimeData.modelCatalog?.runtime ??
    runtimeDefinitions.find((runtime) => runtime.kind === selectedRuntimeKind) ??
    null;
  const supportsQueuedUserMessages = selectedRuntimeDescriptor
    ? runtimeSupportsCapability(
        selectedRuntimeDescriptor,
        "sessionLifecycle.supportsQueuedUserMessages",
      )
    : false;
  const isSessionWorking = isAgentSessionActivityWorking(selectedSessionActivityState);
  const isWaitingInput = selectedSessionActivityState === "waiting_input";
  const canQueueBusyFollowups = isSessionWorking && supportsQueuedUserMessages;
  const selectedRuntimeLabel =
    selectedRuntimeDescriptor?.label ?? selectedRuntimeKind ?? "Current runtime";
  const busySendBlockedReason =
    selectedSessionIdentity !== null && isSessionWorking && !supportsQueuedUserMessages
      ? `${selectedRuntimeLabel} does not support queued messages while the session is working.`
      : null;

  return {
    isSessionWorking,
    isWaitingInput,
    canQueueBusyFollowups,
    busySendBlockedReason,
  };
}

import type { RuntimeDescriptor } from "@openducktor/contracts";
import { getBusyAgentMessageBlockedReason } from "@/lib/agent-message-send-policy";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { isAgentSessionBlockedOnInput } from "@/lib/agent-session-waiting-input";
import { canResumeInterruptedTurn } from "@/lib/agent-session-interrupted-turn";
import type { AgentStudioSelectedSessionState } from "../selected-session/selected-session-state";

type AgentStudioSessionActionStateArgs = {
  selectedSession: AgentStudioSelectedSessionState;
  runtimeDefinitions: RuntimeDescriptor[];
};

export type AgentStudioSessionActionState = {
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  canResumeSession: boolean;
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
  const supportsQueuedUserMessages =
    selectedRuntimeDescriptor?.capabilities.sessionLifecycle.supportsQueuedUserMessages ?? false;
  const isSessionWorking = isAgentSessionActivityWorking(selectedSession.activityState);
  const isWaitingInput = selectedSession.loadedSession
    ? isAgentSessionBlockedOnInput(selectedSession.loadedSession)
    : false;
  const canQueueBusyFollowups = isSessionWorking && supportsQueuedUserMessages;
  const busySendBlockedReason = getBusyAgentMessageBlockedReason(
    isSessionWorking,
    selectedRuntimeDescriptor,
  );
  const canResumeSession =
    selectedSession.identity !== null &&
    canResumeInterruptedTurn({
      activityState: selectedSession.activityState,
      messages: selectedSession.loadedSession?.messages.items ?? [],
      runtimeDescriptor: currentRuntimeDescriptor,
    });

  return {
    isSessionWorking,
    isWaitingInput,
    canResumeSession,
    canQueueBusyFollowups,
    busySendBlockedReason,
  };
}

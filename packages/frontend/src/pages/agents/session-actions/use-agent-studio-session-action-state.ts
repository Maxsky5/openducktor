import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioSessionActionStateArgs = {
  activeSession: AgentSessionState | null;
  activeSessionIsLoadingModelCatalog: boolean;
  activeSessionRuntimeDescriptor?: AgentModelCatalog["runtime"] | null;
  role: AgentRole;
  selectedModelSelection: AgentModelSelection | null;
};

type UseAgentStudioSessionActionStateResult = {
  activeSessionRole: AgentRole;
  activeSessionSelectedModel: AgentSessionState["selectedModel"] | null;
  activeSessionIsLoadingModelCatalog: boolean;
  hasActiveSession: boolean;
  isSessionBusy: boolean;
  isWaitingInput: boolean;
  canQueueBusyFollowups: boolean;
  busySendBlockedReason: string | null;
};

export function useAgentStudioSessionActionState({
  activeSession,
  activeSessionIsLoadingModelCatalog,
  activeSessionRuntimeDescriptor = null,
  role,
  selectedModelSelection,
}: UseAgentStudioSessionActionStateArgs): UseAgentStudioSessionActionStateResult {
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();

  const activeSessionRole = activeSession?.role ?? role;
  const activeSessionSelectedModel = activeSession?.selectedModel ?? null;
  const activeSessionRuntimeKind = activeSession?.runtimeKind ?? null;
  const hasActiveSession = activeSession != null;
  const activeSessionActivityState = activeSession
    ? getAgentSessionActivityStateFromSession(activeSession)
    : null;
  const isSessionBusy = isAgentSessionActivityWorking(activeSessionActivityState);
  const isWaitingInput = activeSessionActivityState === "waiting_input";
  const selectedRuntimeKind =
    selectedModelSelection?.runtimeKind ?? activeSessionSelectedModel?.runtimeKind ?? null;
  const activeRuntimeDescriptor =
    activeSessionRuntimeDescriptor ??
    (selectedRuntimeKind
      ? runtimeDefinitions.find((runtime) => runtime.kind === selectedRuntimeKind)
      : null) ??
    runtimeDefinitions.find((runtime) => runtime.kind === activeSessionRuntimeKind) ??
    null;
  const supportsQueuedUserMessages =
    activeRuntimeDescriptor?.capabilities.sessionLifecycle.supportsQueuedUserMessages !== false;
  const canQueueBusyFollowups = isSessionBusy && !isWaitingInput && supportsQueuedUserMessages;
  const activeRuntimeLabel = activeRuntimeDescriptor?.label ?? "Current runtime";
  const busySendBlockedReason =
    hasActiveSession && isSessionBusy && !isWaitingInput && !supportsQueuedUserMessages
      ? `${activeRuntimeLabel} does not support queued messages while the session is working.`
      : null;

  return {
    activeSessionRole,
    activeSessionSelectedModel,
    activeSessionIsLoadingModelCatalog,
    hasActiveSession,
    isSessionBusy,
    isWaitingInput,
    canQueueBusyFollowups,
    busySendBlockedReason,
  };
}

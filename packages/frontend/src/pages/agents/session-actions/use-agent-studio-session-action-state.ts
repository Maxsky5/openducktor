import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioSessionActionStateArgs = {
  activeSession: AgentSessionState | null;
  role: AgentRole;
  selectedModelSelection: AgentModelSelection | null;
};

export function useAgentStudioSessionActionState({
  activeSession,
  role,
  selectedModelSelection,
}: UseAgentStudioSessionActionStateArgs) {
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();

  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const activeSessionRole = activeSession?.role ?? role;
  const activeSessionStatus = activeSession?.status ?? "stopped";
  const activeSessionSelectedModel = activeSession?.selectedModel ?? null;
  const activeSessionIsLoadingModelCatalog = activeSession?.isLoadingModelCatalog === true;
  const activeSessionPendingApprovals = activeSession?.pendingApprovals ?? [];
  const activeSessionPendingQuestions = activeSession?.pendingQuestions ?? [];
  const activeSessionRuntimeKind = activeSession?.runtimeKind ?? null;
  const activeSessionRuntimeDescriptor = activeSession?.modelCatalog?.runtime ?? null;
  const hasActiveSession = activeSession != null;
  const isSessionBusy =
    hasActiveSession && (activeSessionStatus === "running" || activeSessionStatus === "starting");
  const isWaitingInput =
    hasActiveSession &&
    isAgentSessionWaitingInput({
      pendingApprovals: activeSessionPendingApprovals,
      pendingQuestions: activeSessionPendingQuestions,
    });
  const selectedRuntimeKind =
    selectedModelSelection?.runtimeKind ?? activeSessionSelectedModel?.runtimeKind ?? null;
  const activeRuntimeDescriptor =
    (selectedRuntimeKind
      ? runtimeDefinitions.find((runtime) => runtime.kind === selectedRuntimeKind)
      : null) ??
    activeSessionRuntimeDescriptor ??
    runtimeDefinitions.find((runtime) => runtime.kind === activeSessionRuntimeKind) ??
    null;
  const supportsQueuedUserMessages =
    activeRuntimeDescriptor?.capabilities.sessionLifecycle.supportsQueuedUserMessages !== false;
  const canQueueBusyFollowups =
    activeSessionStatus === "running" && !isWaitingInput && supportsQueuedUserMessages;
  const activeRuntimeLabel = activeRuntimeDescriptor?.label ?? "Current runtime";

  return {
    activeExternalSessionId,
    activeSessionRole,
    activeSessionStatus,
    activeSessionSelectedModel,
    activeSessionIsLoadingModelCatalog,
    activeSessionPendingQuestions,
    hasActiveSession,
    isSessionBusy,
    isWaitingInput,
    canQueueBusyFollowups,
    supportsQueuedUserMessages,
    activeRuntimeLabel,
  };
}

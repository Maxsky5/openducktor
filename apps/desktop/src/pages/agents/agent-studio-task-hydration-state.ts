import type {
  AgentSessionHistoryHydrationState,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { isWaitingForAttachedWorktreeRuntime } from "./agent-studio-session-runtime";

export type AgentStudioReadinessState = "ready" | "checking" | "blocked";

type TaskHydrationSessionState = Pick<
  AgentSessionState,
  "sessionId" | "role" | "runId" | "runtimeId" | "runtimeRoute" | "runtimeRecoveryState"
>;

type GetAgentStudioTaskHydrationDecisionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  activeSession: TaskHydrationSessionState | null;
  historyHydrationState: AgentSessionHistoryHydrationState;
  sessionNeedsHydration: boolean;
  agentStudioReadinessState: AgentStudioReadinessState;
};

export type AgentStudioTaskHydrationDecision = {
  activeRuntimeAttachmentKey: string | null;
  shouldWaitForSessionRuntime: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isRecoveringWaitingSession: boolean;
  shouldHydrateSessionHistory: boolean;
};

export const toRuntimeAttachmentSelectionKey = ({
  activeWorkspace,
  activeTaskId,
  activeSessionId,
}: {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  activeSessionId: string | null;
}): string | null => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  if (!workspaceRepoPath || !activeTaskId || !activeSessionId) {
    return null;
  }

  return `${workspaceRepoPath}::${activeTaskId}::${activeSessionId}`;
};

export const getAgentStudioTaskHydrationDecision = ({
  activeWorkspace,
  activeTaskId,
  activeSession,
  historyHydrationState,
  sessionNeedsHydration,
  agentStudioReadinessState,
}: GetAgentStudioTaskHydrationDecisionArgs): AgentStudioTaskHydrationDecision => {
  const activeRuntimeAttachmentKey = toRuntimeAttachmentSelectionKey({
    activeWorkspace,
    activeTaskId,
    activeSessionId: activeSession?.sessionId ?? null,
  });
  const shouldWaitForSessionRuntime =
    activeRuntimeAttachmentKey !== null &&
    agentStudioReadinessState === "ready" &&
    sessionNeedsHydration &&
    isWaitingForAttachedWorktreeRuntime(activeSession);
  const isRecoveringWaitingSession = activeSession?.runtimeRecoveryState === "recovering_runtime";
  const isWaitingForRuntimeReadiness =
    activeRuntimeAttachmentKey !== null &&
    sessionNeedsHydration &&
    (agentStudioReadinessState !== "ready" ||
      shouldWaitForSessionRuntime ||
      isRecoveringWaitingSession);
  const shouldHydrateSessionHistory =
    activeRuntimeAttachmentKey !== null &&
    agentStudioReadinessState === "ready" &&
    !shouldWaitForSessionRuntime &&
    !isRecoveringWaitingSession &&
    sessionNeedsHydration &&
    historyHydrationState === "not_requested";

  return {
    activeRuntimeAttachmentKey,
    shouldWaitForSessionRuntime,
    isWaitingForRuntimeReadiness,
    isRecoveringWaitingSession,
    shouldHydrateSessionHistory,
  };
};

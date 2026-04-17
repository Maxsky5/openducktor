import type {
  AgentSessionHistoryHydrationState,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { isWaitingForAttachedWorktreeRuntime } from "./agent-studio-session-runtime";

export type AgentStudioReadinessState = "ready" | "checking" | "blocked";

type TaskHydrationSessionState = Pick<
  AgentSessionState,
  "sessionId" | "role" | "runId" | "runtimeId" | "runtimeRoute" | "runtimeRecoveryState"
>;

type GetAgentStudioTaskHydrationDecisionArgs = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: TaskHydrationSessionState | null;
  historyHydrationState: AgentSessionHistoryHydrationState;
  sessionNeedsHydration: boolean;
  agentStudioReadinessState: AgentStudioReadinessState;
};

export type AgentStudioTaskHydrationDecision = {
  activeRuntimeAttachmentKey: string | null;
  blockedFromAutomaticRecovery: boolean;
  shouldWaitForSessionRuntime: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isRecoveringWaitingSession: boolean;
  shouldHydrateSessionHistory: boolean;
};

export const toRuntimeAttachmentSelectionKey = ({
  activeRepo,
  activeTaskId,
  activeSessionId,
}: {
  activeRepo: string | null;
  activeTaskId: string;
  activeSessionId: string | null;
}): string | null => {
  if (!activeRepo || !activeTaskId || !activeSessionId) {
    return null;
  }

  return `${activeRepo}::${activeTaskId}::${activeSessionId}`;
};

export const getAgentStudioTaskHydrationDecision = ({
  activeRepo,
  activeTaskId,
  activeSession,
  historyHydrationState,
  sessionNeedsHydration,
  agentStudioReadinessState,
}: GetAgentStudioTaskHydrationDecisionArgs): AgentStudioTaskHydrationDecision => {
  const activeRuntimeAttachmentKey = toRuntimeAttachmentSelectionKey({
    activeRepo,
    activeTaskId,
    activeSessionId: activeSession?.sessionId ?? null,
  });
  const blockedFromAutomaticRecovery = false;
  const shouldWaitForSessionRuntime =
    activeRuntimeAttachmentKey !== null &&
    agentStudioReadinessState === "ready" &&
    sessionNeedsHydration &&
    isWaitingForAttachedWorktreeRuntime(activeSession) &&
    !blockedFromAutomaticRecovery;
  const isRecoveringWaitingSession = activeSession?.runtimeRecoveryState === "recovering_runtime";
  const isWaitingForRuntimeReadiness =
    activeRuntimeAttachmentKey !== null &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery &&
    (agentStudioReadinessState !== "ready" ||
      shouldWaitForSessionRuntime ||
      isRecoveringWaitingSession);
  const shouldHydrateSessionHistory =
    activeRuntimeAttachmentKey !== null &&
    agentStudioReadinessState === "ready" &&
    !shouldWaitForSessionRuntime &&
    !isRecoveringWaitingSession &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery &&
    historyHydrationState === "not_requested";

  return {
    activeRuntimeAttachmentKey,
    blockedFromAutomaticRecovery,
    shouldWaitForSessionRuntime,
    isWaitingForRuntimeReadiness,
    isRecoveringWaitingSession,
    shouldHydrateSessionHistory,
  };
};

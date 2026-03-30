import type {
  AgentSessionHistoryHydrationState,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { isWaitingForAttachedWorktreeRuntime } from "./agent-studio-session-runtime";

type AgentStudioReadinessState = "ready" | "checking" | "blocked";

type TaskHydrationSessionState = Pick<
  AgentSessionState,
  "sessionId" | "role" | "runId" | "runtimeId" | "runtimeEndpoint"
>;

type GetAgentStudioTaskHydrationDecisionArgs = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: TaskHydrationSessionState | null;
  historyHydrationState: AgentSessionHistoryHydrationState;
  sessionNeedsHydration: boolean;
  agentStudioReadinessState: AgentStudioReadinessState;
  waitingRecoveryKey: string | null;
  postReadyFailureRecoveryKey: string | null;
};

export type AgentStudioTaskHydrationDecision = {
  activeRecoveryKey: string | null;
  blockedFromAutomaticRecovery: boolean;
  shouldWaitForSessionRuntime: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isRecoveringWaitingSession: boolean;
  shouldHydrateSessionHistory: boolean;
};

export const toRecoverySelectionKey = ({
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
  waitingRecoveryKey,
  postReadyFailureRecoveryKey,
}: GetAgentStudioTaskHydrationDecisionArgs): AgentStudioTaskHydrationDecision => {
  const activeRecoveryKey = toRecoverySelectionKey({
    activeRepo,
    activeTaskId,
    activeSessionId: activeSession?.sessionId ?? null,
  });
  const blockedFromAutomaticRecovery =
    activeRecoveryKey !== null && postReadyFailureRecoveryKey === activeRecoveryKey;
  const shouldWaitForSessionRuntime =
    activeRecoveryKey !== null &&
    agentStudioReadinessState === "ready" &&
    sessionNeedsHydration &&
    isWaitingForAttachedWorktreeRuntime(activeSession) &&
    !blockedFromAutomaticRecovery;
  const isWaitingForRuntimeReadiness =
    activeRecoveryKey !== null &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery &&
    (agentStudioReadinessState !== "ready" || shouldWaitForSessionRuntime);
  const isRecoveringWaitingSession =
    activeRecoveryKey !== null &&
    agentStudioReadinessState === "ready" &&
    !shouldWaitForSessionRuntime &&
    waitingRecoveryKey === activeRecoveryKey &&
    sessionNeedsHydration;
  const shouldHydrateSessionHistory =
    activeRecoveryKey !== null &&
    agentStudioReadinessState === "ready" &&
    !shouldWaitForSessionRuntime &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery &&
    (historyHydrationState === "not_requested" || waitingRecoveryKey === activeRecoveryKey);

  return {
    activeRecoveryKey,
    blockedFromAutomaticRecovery,
    shouldWaitForSessionRuntime,
    isWaitingForRuntimeReadiness,
    isRecoveringWaitingSession,
    shouldHydrateSessionHistory,
  };
};

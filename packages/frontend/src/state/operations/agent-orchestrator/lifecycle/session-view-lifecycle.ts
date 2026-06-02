import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "../support/history-hydration";
import { getSessionMessageCount } from "../support/messages";
import { hasPendingOutboundSend } from "../support/pending-outbound-send";
import { hasAttachedSessionRuntime } from "../support/session-runtime-attachment";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionViewLifecyclePhase =
  | "idle"
  | "blocked_on_repo"
  | "recovering_runtime"
  | "needs_history"
  | "hydrating_history"
  | "history_failed"
  | "ready";

export type AgentSessionViewLifecycle = {
  phase: AgentSessionViewLifecyclePhase;
  canReadRuntimeData: boolean;
  canRenderHistory: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isHydratingHistory: boolean;
  isHistoryHydrationFailed: boolean;
  shouldEnsureReadyForView: boolean;
};

export const deriveAgentSessionViewLifecycle = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!session) {
    return {
      phase: "idle",
      canReadRuntimeData: false,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  const sessionNeedsHydration = requiresHydratedAgentSessionHistory(session);
  const historyHydrationState = getAgentSessionHistoryHydrationState(session);
  const hasTranscript = getSessionMessageCount(session) > 0;
  const hasRuntimeAttachment = hasAttachedSessionRuntime(session);
  const shouldRefreshRunningSession =
    repoReadinessState === "ready" &&
    session.status === "running" &&
    !hasPendingOutboundSend(session);

  if (repoReadinessState !== "ready" && sessionNeedsHydration && !hasTranscript) {
    return {
      phase: "blocked_on_repo",
      canReadRuntimeData: false,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: true,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  if (session.runtimeRecoveryState === "recovering_runtime") {
    return {
      phase: "recovering_runtime",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: true,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  if (!sessionNeedsHydration) {
    return {
      phase: "ready",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: true,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: shouldRefreshRunningSession,
    };
  }

  if (historyHydrationState === "hydrating") {
    return {
      phase: "hydrating_history",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: true,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  if (historyHydrationState === "not_requested") {
    return {
      phase: "needs_history",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: repoReadinessState === "ready",
    };
  }

  if (historyHydrationState === "failed" && hasTranscript) {
    return {
      phase: "needs_history",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: true,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: repoReadinessState === "ready",
    };
  }

  const shouldShowBlockingHistoryFailure = !hasTranscript && historyHydrationState === "failed";
  if (shouldShowBlockingHistoryFailure) {
    return {
      phase: "history_failed",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: true,
      shouldEnsureReadyForView: repoReadinessState === "ready",
    };
  }

  return {
    phase: "ready",
    canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
    canRenderHistory: hasTranscript || historyHydrationState === "hydrated",
    isWaitingForRuntimeReadiness: false,
    isHydratingHistory: false,
    isHistoryHydrationFailed: false,
    shouldEnsureReadyForView: shouldRefreshRunningSession,
  };
};

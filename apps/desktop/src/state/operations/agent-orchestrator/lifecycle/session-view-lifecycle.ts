import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "../support/history-hydration";
import { getSessionMessageCount } from "../support/messages";
import {
  hasAttachedSessionRuntime,
  isWaitingForAttachedWorktreeRuntime,
} from "../support/session-runtime-attachment";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionViewLifecyclePhase =
  | "idle"
  | "blocked_on_repo"
  | "waiting_for_runtime_attachment"
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
  shouldWaitForRuntimeAttachment: boolean;
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
      shouldWaitForRuntimeAttachment: false,
    };
  }

  const sessionNeedsHydration = requiresHydratedAgentSessionHistory(session);
  const historyHydrationState = getAgentSessionHistoryHydrationState(session);
  const hasTranscript = getSessionMessageCount(session) > 0;
  const hasRuntimeAttachment = hasAttachedSessionRuntime(session);
  const shouldWaitForRuntimeAttachment =
    repoReadinessState === "ready" &&
    sessionNeedsHydration &&
    isWaitingForAttachedWorktreeRuntime(session);

  if (hasTranscript && historyHydrationState !== "hydrating") {
    return {
      phase: "ready",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: true,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
      shouldWaitForRuntimeAttachment: false,
    };
  }

  if (repoReadinessState !== "ready" && sessionNeedsHydration && !hasTranscript) {
    return {
      phase: "blocked_on_repo",
      canReadRuntimeData: false,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: true,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
      shouldWaitForRuntimeAttachment: false,
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
      shouldWaitForRuntimeAttachment,
    };
  }

  if (shouldWaitForRuntimeAttachment) {
    return {
      phase: "waiting_for_runtime_attachment",
      canReadRuntimeData: false,
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: true,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: true,
      shouldWaitForRuntimeAttachment: true,
    };
  }

  if (!sessionNeedsHydration) {
    return {
      phase: "ready",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: false,
      shouldWaitForRuntimeAttachment: false,
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
      shouldWaitForRuntimeAttachment: false,
    };
  }

  const shouldRequestHistory = !hasTranscript && historyHydrationState === "not_requested";
  if (shouldRequestHistory) {
    return {
      phase: "needs_history",
      canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: false,
      isHydratingHistory: false,
      isHistoryHydrationFailed: false,
      shouldEnsureReadyForView: repoReadinessState === "ready",
      shouldWaitForRuntimeAttachment: false,
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
      shouldWaitForRuntimeAttachment: false,
    };
  }

  return {
    phase: "ready",
    canReadRuntimeData: repoReadinessState === "ready" && hasRuntimeAttachment,
    canRenderHistory: hasTranscript || historyHydrationState === "hydrated",
    isWaitingForRuntimeReadiness: false,
    isHydratingHistory: false,
    isHistoryHydrationFailed: false,
    shouldEnsureReadyForView: false,
    shouldWaitForRuntimeAttachment: false,
  };
};

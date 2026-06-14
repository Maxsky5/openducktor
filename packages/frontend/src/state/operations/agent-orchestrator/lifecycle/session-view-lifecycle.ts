import type { AgentSessionRouteIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { getSessionMessageCount } from "../support/messages";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionViewLifecyclePhase =
  | "inactive"
  | "resolving_session"
  | "resolving_runtime"
  | "waiting_for_runtime"
  | "needs_initial_history"
  | "needs_history"
  | "loading_history"
  | "refreshing_history"
  | "history_failed"
  | "ready";

export type AgentSessionTranscriptState =
  | { kind: "empty" }
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: "preparing" | "history" }
  | { kind: "visible" }
  | { kind: "failed" };

export type AgentSessionViewLifecycle = {
  phase: AgentSessionViewLifecyclePhase;
  repoReadinessState: SessionRepoReadinessState;
};

export type SelectedAgentSessionViewLifecycle = AgentSessionViewLifecycle;

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = {
  phase: "inactive",
  repoReadinessState: "ready",
};

export const createResolvingSelectedSessionViewLifecycle =
  (): SelectedAgentSessionViewLifecycle => ({
    phase: "resolving_session",
    repoReadinessState: "ready",
  });

export const createFailedSelectedSessionViewLifecycle = (): SelectedAgentSessionViewLifecycle => ({
  phase: "history_failed",
  repoReadinessState: "ready",
});

export const getAgentSessionTranscriptState = ({
  phase,
}: Pick<AgentSessionViewLifecycle, "phase">): AgentSessionTranscriptState => {
  switch (phase) {
    case "inactive":
      return { kind: "empty" };
    case "resolving_runtime":
    case "waiting_for_runtime":
      return { kind: "runtime_waiting" };
    case "resolving_session":
      return { kind: "session_loading", reason: "preparing" };
    case "needs_initial_history":
    case "loading_history":
      return { kind: "session_loading", reason: "history" };
    case "history_failed":
      return { kind: "failed" };
    case "refreshing_history":
    case "needs_history":
    case "ready":
      return { kind: "visible" };
  }
};

export const canReadAgentSessionRuntimeData = (
  lifecycle: SelectedAgentSessionViewLifecycle,
): boolean => {
  if (lifecycle.repoReadinessState !== "ready") {
    return false;
  }
  switch (lifecycle.phase) {
    case "inactive":
    case "resolving_session":
    case "resolving_runtime":
    case "waiting_for_runtime":
      return false;
    case "needs_initial_history":
    case "needs_history":
    case "loading_history":
    case "refreshing_history":
    case "history_failed":
    case "ready":
      return true;
  }
};

export const shouldLoadAgentSessionHistory = (
  lifecycle: SelectedAgentSessionViewLifecycle,
): boolean =>
  lifecycle.repoReadinessState === "ready" &&
  (lifecycle.phase === "needs_initial_history" || lifecycle.phase === "needs_history");

export const isSelectedAgentSessionResolving = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "phase">,
): boolean => lifecycle.phase === "resolving_session" || lifecycle.phase === "resolving_runtime";

export const isSelectedAgentSessionWaitingForRuntimeReadiness = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "phase">,
): boolean => lifecycle.phase === "resolving_runtime" || lifecycle.phase === "waiting_for_runtime";

export const isSelectedAgentSessionViewLoading = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "phase">,
): boolean =>
  lifecycle.phase === "resolving_session" ||
  lifecycle.phase === "resolving_runtime" ||
  lifecycle.phase === "waiting_for_runtime" ||
  lifecycle.phase === "needs_initial_history" ||
  lifecycle.phase === "loading_history";

export const deriveAgentSessionViewLifecycle = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!session) {
    return {
      phase: "inactive",
      repoReadinessState,
    };
  }

  const historyLoadState = session.historyLoadState;
  const hasTranscript = getSessionMessageCount(session) > 0;

  if (repoReadinessState !== "ready" && historyLoadState !== "loaded" && !hasTranscript) {
    return {
      phase: "waiting_for_runtime",
      repoReadinessState,
    };
  }

  switch (historyLoadState) {
    case "loaded":
      return {
        phase: "ready",
        repoReadinessState,
      };
    case "loading":
      return {
        phase: hasTranscript ? "refreshing_history" : "loading_history",
        repoReadinessState,
      };
    case "not_requested":
      return {
        phase: hasTranscript ? "needs_history" : "needs_initial_history",
        repoReadinessState,
      };
    case "failed":
      return {
        phase: hasTranscript ? "needs_history" : "history_failed",
        repoReadinessState,
      };
  }
};

export const deriveSelectedAgentSessionViewLifecycle = ({
  selectedSessionRoute,
  session,
  hasSelectedTask,
  repoReadinessState,
  sessionLoadError,
}: {
  selectedSessionRoute: AgentSessionRouteIdentity | null;
  session: AgentSessionState | null;
  hasSelectedTask: boolean;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
}): SelectedAgentSessionViewLifecycle => {
  if (!selectedSessionRoute) {
    if (hasSelectedTask && repoReadinessState !== "ready") {
      return {
        phase: "waiting_for_runtime",
        repoReadinessState,
      };
    }
    return inactiveSelectedSessionViewLifecycle;
  }

  if (!session) {
    const hasLoadFailed = sessionLoadError !== null && sessionLoadError !== undefined;
    return {
      phase: hasLoadFailed
        ? "history_failed"
        : repoReadinessState !== "ready"
          ? "resolving_runtime"
          : "resolving_session",
      repoReadinessState,
    };
  }

  return deriveAgentSessionViewLifecycle({ session, repoReadinessState });
};

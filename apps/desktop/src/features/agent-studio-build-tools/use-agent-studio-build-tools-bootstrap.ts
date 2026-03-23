import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "@/pages/agents/use-agent-studio-orchestration-controller";

type UseAgentStudioBuildToolsBootstrapArgs = {
  activeRepo: string | null;
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewActiveSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
};

type BuildToolsBootstrapContext = {
  isEnabled: boolean;
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
  sessionRunId: string | null;
  shouldEnableEventPolling: boolean;
  hasSelectedTask: boolean;
};

export function useAgentStudioBuildToolsBootstrap({
  activeRepo,
  viewRole,
  viewActiveSession,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  isViewSessionHistoryHydrating,
}: UseAgentStudioBuildToolsBootstrapArgs): BuildToolsBootstrapContext {
  return useMemo(() => {
    const isVisibleBuildToolsPanel =
      viewRole === "build" && panelKind === "build_tools" && isPanelOpen;
    if (!isVisibleBuildToolsPanel) {
      return {
        isEnabled: false,
        repoPath: null,
        sessionWorkingDirectory: null,
        sessionRunId: null,
        shouldEnableEventPolling: false,
        hasSelectedTask: Boolean(viewSelectedTask),
      };
    }

    const isBuildSessionContextStable =
      viewActiveSession?.role !== "build" || !isViewSessionHistoryHydrating;

    return {
      isEnabled: Boolean(activeRepo) && isBuildSessionContextStable,
      repoPath: isBuildSessionContextStable ? activeRepo : null,
      sessionWorkingDirectory: isBuildSessionContextStable
        ? (viewActiveSession?.workingDirectory ?? null)
        : null,
      sessionRunId: isBuildSessionContextStable ? (viewActiveSession?.runId ?? null) : null,
      shouldEnableEventPolling:
        Boolean(activeRepo) && isBuildSessionContextStable && Boolean(viewActiveSession),
      hasSelectedTask: Boolean(viewSelectedTask),
    };
  }, [
    activeRepo,
    isPanelOpen,
    isViewSessionHistoryHydrating,
    panelKind,
    viewActiveSession,
    viewRole,
    viewSelectedTask,
  ]);
}

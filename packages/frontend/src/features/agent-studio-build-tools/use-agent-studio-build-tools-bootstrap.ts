import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "@/pages/agents/use-agent-studio-orchestration-controller";

export type BuildToolsSelectedView = Pick<
  AgentStudioOrchestrationSelectionContext["view"],
  "role" | "taskId" | "selectedTask" | "selectedSessionIdentity" | "selectedSessionActivityState"
>;

type UseAgentStudioBuildToolsBootstrapArgs = {
  workspaceRepoPath: string | null;
  selectedView: BuildToolsSelectedView;
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
};

type BuildToolsBootstrapContext = {
  isEnabled: boolean;
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
  shouldEnableScheduledRefresh: boolean;
};

export function useAgentStudioBuildToolsBootstrap({
  workspaceRepoPath,
  selectedView,
  panelKind,
  isPanelOpen,
}: UseAgentStudioBuildToolsBootstrapArgs): BuildToolsBootstrapContext {
  const selectedSessionIdentity = selectedView.selectedSessionIdentity;

  return useMemo(() => {
    const isVisibleBuildToolsPanel =
      selectedView.role === "build" && panelKind === "build_tools" && isPanelOpen;
    if (!isVisibleBuildToolsPanel) {
      return {
        isEnabled: false,
        repoPath: null,
        sessionWorkingDirectory: null,
        shouldEnableScheduledRefresh: false,
      };
    }

    return {
      isEnabled: Boolean(workspaceRepoPath),
      repoPath: workspaceRepoPath,
      sessionWorkingDirectory: selectedSessionIdentity?.workingDirectory ?? null,
      shouldEnableScheduledRefresh: Boolean(workspaceRepoPath && selectedSessionIdentity),
    };
  }, [workspaceRepoPath, isPanelOpen, panelKind, selectedView.role, selectedSessionIdentity]);
}

import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "@/pages/agents/use-agent-studio-orchestration-controller";

export type BuildToolsSelectedView = Pick<
  AgentStudioOrchestrationSelectionContext["view"],
  "role" | "taskId" | "selectedTask" | "selectedSession"
>;

type UseAgentStudioBuildToolsBootstrapArgs = {
  workspaceRepoPath: string | null;
  selectedView: BuildToolsSelectedView;
  isGitTabActive: boolean;
  isRightPanelOpen: boolean;
};

type BuildToolsBootstrapContext = {
  isEnabled: boolean;
  isDevServerEnabled: boolean;
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
  shouldEnableScheduledRefresh: boolean;
};

export function useAgentStudioBuildToolsBootstrap({
  workspaceRepoPath,
  selectedView,
  isGitTabActive,
  isRightPanelOpen,
}: UseAgentStudioBuildToolsBootstrapArgs): BuildToolsBootstrapContext {
  const selectedSessionIdentity = selectedView.selectedSession.identity;

  return useMemo(() => {
    if (!workspaceRepoPath) {
      return {
        isEnabled: false,
        isDevServerEnabled: false,
        repoPath: null,
        sessionWorkingDirectory: null,
        shouldEnableScheduledRefresh: false,
      };
    }

    return {
      isEnabled: isGitTabActive,
      isDevServerEnabled: selectedView.role === "build" && isRightPanelOpen,
      repoPath: workspaceRepoPath,
      sessionWorkingDirectory: selectedSessionIdentity?.workingDirectory ?? null,
      shouldEnableScheduledRefresh: Boolean(isGitTabActive && selectedSessionIdentity),
    };
  }, [
    workspaceRepoPath,
    isGitTabActive,
    isRightPanelOpen,
    selectedView.role,
    selectedSessionIdentity,
  ]);
}

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
  isGitTabActive,
}: UseAgentStudioBuildToolsBootstrapArgs): BuildToolsBootstrapContext {
  const selectedSessionIdentity = selectedView.selectedSession.identity;

  return useMemo(() => {
    if (!workspaceRepoPath) {
      return {
        isEnabled: false,
        repoPath: null,
        sessionWorkingDirectory: null,
        shouldEnableScheduledRefresh: false,
      };
    }

    return {
      isEnabled: isGitTabActive,
      repoPath: workspaceRepoPath,
      sessionWorkingDirectory: selectedSessionIdentity?.workingDirectory ?? null,
      shouldEnableScheduledRefresh: Boolean(isGitTabActive && selectedSessionIdentity),
    };
  }, [workspaceRepoPath, isGitTabActive, selectedSessionIdentity]);
}

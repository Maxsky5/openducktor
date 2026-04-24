import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "@/pages/agents/use-agent-studio-orchestration-controller";

export type BuildToolsSessionDescriptor = {
  role: AgentStudioOrchestrationSelectionContext["viewActiveSession"] extends infer T
    ? T extends { role: infer TRole | null }
      ? TRole | null
      : null
    : null;
  status: AgentStudioOrchestrationSelectionContext["viewActiveSession"] extends infer T
    ? T extends { status: infer TStatus | null }
      ? TStatus | null
      : null
    : null;
  workingDirectory: string | null;
  hasActiveSession: boolean;
};

type UseAgentStudioBuildToolsBootstrapArgs = {
  workspaceRepoPath: string | null;
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  session: BuildToolsSessionDescriptor;
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
};

type BuildToolsBootstrapContext = {
  isEnabled: boolean;
  repoPath: string | null;
  taskId: string | null;
  sessionWorkingDirectory: string | null;
  shouldEnableEventPolling: boolean;
  hasSelectedTask: boolean;
};

export function useAgentStudioBuildToolsBootstrap({
  workspaceRepoPath,
  viewRole,
  session,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  isViewSessionHistoryHydrating,
}: UseAgentStudioBuildToolsBootstrapArgs): BuildToolsBootstrapContext {
  const sessionRole = session.role;
  const sessionWorkingDirectory = session.workingDirectory;
  const hasActiveSession = session.hasActiveSession;

  return useMemo(() => {
    const isVisibleBuildToolsPanel =
      viewRole === "build" && panelKind === "build_tools" && isPanelOpen;
    if (!isVisibleBuildToolsPanel) {
      return {
        isEnabled: false,
        repoPath: null,
        taskId: null,
        sessionWorkingDirectory: null,
        shouldEnableEventPolling: false,
        hasSelectedTask: Boolean(viewSelectedTask),
      };
    }

    const isBuildSessionContextStable = sessionRole !== "build" || !isViewSessionHistoryHydrating;

    return {
      isEnabled: Boolean(workspaceRepoPath) && isBuildSessionContextStable,
      repoPath: isBuildSessionContextStable ? workspaceRepoPath : null,
      taskId: isBuildSessionContextStable ? (viewSelectedTask?.id ?? null) : null,
      sessionWorkingDirectory: isBuildSessionContextStable ? sessionWorkingDirectory : null,
      shouldEnableEventPolling:
        Boolean(workspaceRepoPath) && isBuildSessionContextStable && hasActiveSession,
      hasSelectedTask: Boolean(viewSelectedTask),
    };
  }, [
    workspaceRepoPath,
    hasActiveSession,
    isPanelOpen,
    isViewSessionHistoryHydrating,
    panelKind,
    sessionRole,
    sessionWorkingDirectory,
    viewRole,
    viewSelectedTask,
  ]);
}

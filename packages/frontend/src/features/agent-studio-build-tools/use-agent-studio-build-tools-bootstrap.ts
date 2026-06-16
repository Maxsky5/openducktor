import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "@/pages/agents/use-agent-studio-orchestration-controller";
import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

export type BuildToolsSelectedView = Pick<
  AgentStudioOrchestrationSelectionContext["view"],
  "role" | "taskId" | "selectedTask" | "activeSession" | "transcriptState"
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
  taskId: string | null;
  sessionWorkingDirectory: string | null;
  shouldEnableEventPolling: boolean;
  hasSelectedTask: boolean;
};

export const isBuildToolsSessionContextStable = ({
  activeSession,
  transcriptState,
}: {
  activeSession: BuildToolsSelectedView["activeSession"];
  transcriptState: AgentSessionTranscriptState;
}): boolean => activeSession?.role !== "build" || !isAgentSessionTranscriptLoading(transcriptState);

export function useAgentStudioBuildToolsBootstrap({
  workspaceRepoPath,
  selectedView,
  panelKind,
  isPanelOpen,
}: UseAgentStudioBuildToolsBootstrapArgs): BuildToolsBootstrapContext {
  const activeSession = selectedView.activeSession;
  const sessionWorkingDirectory = activeSession?.workingDirectory ?? null;

  return useMemo(() => {
    const isVisibleBuildToolsPanel =
      selectedView.role === "build" && panelKind === "build_tools" && isPanelOpen;
    if (!isVisibleBuildToolsPanel) {
      return {
        isEnabled: false,
        repoPath: null,
        taskId: null,
        sessionWorkingDirectory: null,
        shouldEnableEventPolling: false,
        hasSelectedTask: Boolean(selectedView.selectedTask),
      };
    }

    const isBuildSessionContextStable = isBuildToolsSessionContextStable({
      activeSession,
      transcriptState: selectedView.transcriptState,
    });

    return {
      isEnabled: Boolean(workspaceRepoPath) && isBuildSessionContextStable,
      repoPath: isBuildSessionContextStable ? workspaceRepoPath : null,
      taskId: isBuildSessionContextStable ? (selectedView.selectedTask?.id ?? null) : null,
      sessionWorkingDirectory: isBuildSessionContextStable ? sessionWorkingDirectory : null,
      shouldEnableEventPolling:
        Boolean(workspaceRepoPath) && isBuildSessionContextStable && activeSession !== null,
      hasSelectedTask: Boolean(selectedView.selectedTask),
    };
  }, [
    workspaceRepoPath,
    activeSession,
    isPanelOpen,
    panelKind,
    selectedView,
    sessionWorkingDirectory,
  ]);
}

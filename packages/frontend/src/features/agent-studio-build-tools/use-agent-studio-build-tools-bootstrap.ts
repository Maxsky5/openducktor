import { useMemo } from "react";
import type { AgentSessionActivityState } from "@/lib/agent-session-activity-state";
import type { AgentStudioOrchestrationSelectionContext } from "@/pages/agents/use-agent-studio-orchestration-controller";
import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

export type BuildToolsSessionDescriptor = {
  role: AgentStudioOrchestrationSelectionContext["viewActiveSession"] extends infer T
    ? T extends { role: infer TRole | null }
      ? TRole | null
      : null
    : null;
  activityState: AgentSessionActivityState | null;
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
  transcriptState: AgentSessionTranscriptState;
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
  sessionRole,
  transcriptState,
}: {
  sessionRole: BuildToolsSessionDescriptor["role"];
  transcriptState: AgentSessionTranscriptState;
}): boolean => sessionRole !== "build" || !isAgentSessionTranscriptLoading(transcriptState);

export function useAgentStudioBuildToolsBootstrap({
  workspaceRepoPath,
  viewRole,
  session,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  transcriptState,
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

    const isBuildSessionContextStable = isBuildToolsSessionContextStable({
      sessionRole,
      transcriptState,
    });

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
    panelKind,
    sessionRole,
    sessionWorkingDirectory,
    transcriptState,
    viewRole,
    viewSelectedTask,
  ]);
}

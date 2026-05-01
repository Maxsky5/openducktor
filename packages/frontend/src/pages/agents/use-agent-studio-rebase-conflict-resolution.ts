import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import { useGitConflictResolution } from "@/features/git-conflict-resolution";
import type {
  SessionStartExistingSessionOption,
  SessionStartLaunchRequest,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import type { ActiveWorkspace } from "../../types/state-slices";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import {
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
} from "./agents-page-selection";

type AgentStudioRebaseConflictResolutionSelectionContext = {
  viewTaskId: string;
  viewSelectedTask: TaskCard | null;
  viewActiveSession: AgentSessionSummary | null;
  activeSession: AgentSessionSummary | null;
  selectedSessionById: AgentSessionSummary | null;
  viewSessionsForTask: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
};

type UseAgentStudioRebaseConflictResolutionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  selection: AgentStudioRebaseConflictResolutionSelectionContext;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  onContextSwitchIntent: () => void;
  startSessionRequest: (
    request: SessionStartLaunchRequest & {
      role: "build";
      launchActionId: "build_rebase_conflict_resolution";
      reason: "rebase_conflict_resolution";
      postStartAction: "send_message";
      message: string;
      targetWorkingDirectory?: string | null;
      existingSessionOptions?: SessionStartExistingSessionOption[];
      initialSourceExternalSessionId?: string | null;
    },
  ) => Promise<string | undefined>;
  loadPromptOverrides?: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type UseAgentStudioRebaseConflictResolutionResult = {
  handleResolveRebaseConflict: (conflict: GitConflict) => Promise<boolean>;
};

export function useAgentStudioRebaseConflictResolution({
  activeWorkspace,
  selection,
  scheduleQueryUpdate,
  onContextSwitchIntent,
  startSessionRequest,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseAgentStudioRebaseConflictResolutionArgs): UseAgentStudioRebaseConflictResolutionResult {
  const { handleResolveGitConflict } = useGitConflictResolution({
    activeWorkspace,
    startConflictResolutionSession: async (request) =>
      startSessionRequest({
        taskId: request.taskId,
        role: request.role,
        launchActionId: "build_rebase_conflict_resolution" as const,
        reason: "rebase_conflict_resolution",
        postStartAction: "send_message",
        message: request.message,
        initialStartMode: request.initialStartMode,
        targetWorkingDirectory: request.targetWorkingDirectory,
        ...(request.existingSessionOptions.length > 0
          ? { existingSessionOptions: request.existingSessionOptions }
          : {}),
        ...(request.initialSourceExternalSessionId !== undefined
          ? { initialSourceExternalSessionId: request.initialSourceExternalSessionId }
          : {}),
      }),
    loadPromptOverrides,
  });

  const handleResolveRebaseConflict = useCallback(
    async (conflict: GitConflict): Promise<boolean> => {
      if (!selection.viewTaskId) {
        throw new Error("Cannot resolve a git conflict because no task is selected.");
      }

      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        taskId: selection.viewTaskId,
        viewActiveSession: selection.viewActiveSession,
        activeSession: selection.activeSession,
        selectedSessionById: selection.selectedSessionById,
        viewSessionsForTask: selection.viewSessionsForTask,
        sessionsForTask: selection.sessionsForTask,
      });
      const defaultBuilderSession = resolveAgentStudioBuilderSessionForTask({
        taskId: selection.viewTaskId,
        viewActiveSession: selection.viewActiveSession,
        activeSession: selection.activeSession,
        selectedSessionById: selection.selectedSessionById,
        viewSessionsForTask: selection.viewSessionsForTask,
        sessionsForTask: selection.sessionsForTask,
      });

      return handleResolveGitConflict(conflict, {
        taskId: selection.viewTaskId,
        task: selection.viewSelectedTask,
        builderSessions,
        currentViewSessionId:
          selection.viewActiveSession?.role === "build"
            ? selection.viewActiveSession.externalSessionId
            : null,
        onOpenSession: (externalSessionId) => {
          const session = builderSessions.find(
            (entry) => entry.externalSessionId === externalSessionId,
          );
          if (
            selection.viewActiveSession?.externalSessionId !== externalSessionId ||
            selection.viewActiveSession?.role !== "build"
          ) {
            onContextSwitchIntent();
          }
          scheduleQueryUpdate({
            task: selection.viewTaskId,
            session: externalSessionId,
            agent: session?.role ?? defaultBuilderSession?.role ?? "build",
          });
        },
      });
    },
    [handleResolveGitConflict, onContextSwitchIntent, scheduleQueryUpdate, selection],
  );

  return {
    handleResolveRebaseConflict,
  };
}

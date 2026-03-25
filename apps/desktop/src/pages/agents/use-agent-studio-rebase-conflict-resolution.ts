import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import { useGitConflictResolution } from "@/features/git-conflict-resolution";
import type { SessionStartExistingSessionOption } from "@/features/session-start";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import {
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
} from "./agents-page-selection";

type AgentStudioRebaseConflictResolutionSelectionContext = {
  viewTaskId: string;
  viewSelectedTask: TaskCard | null;
  viewActiveSession: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  selectedSessionById: AgentSessionState | null;
  viewSessionsForTask: AgentSessionState[];
  sessionsForTask: AgentSessionState[];
};

type UseAgentStudioRebaseConflictResolutionArgs = {
  activeRepo: string | null;
  selection: AgentStudioRebaseConflictResolutionSelectionContext;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  onContextSwitchIntent: () => void;
  startSessionRequest: (request: {
    taskId: string;
    role: "build";
    scenario: "build_rebase_conflict_resolution";
    reason: "rebase_conflict_resolution";
    postStartAction: "send_message";
    message: string;
    initialStartMode?: "fresh" | "reuse" | "fork";
    targetWorkingDirectory?: string | null;
    existingSessionOptions?: SessionStartExistingSessionOption[];
    initialSourceSessionId?: string | null;
  }) => Promise<string | undefined>;
  loadPromptOverrides?: (repoPath: string) => Promise<RepoPromptOverrides>;
};

type UseAgentStudioRebaseConflictResolutionResult = {
  handleResolveRebaseConflict: (conflict: GitConflict) => Promise<boolean>;
};

export function useAgentStudioRebaseConflictResolution({
  activeRepo,
  selection,
  scheduleQueryUpdate,
  onContextSwitchIntent,
  startSessionRequest,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseAgentStudioRebaseConflictResolutionArgs): UseAgentStudioRebaseConflictResolutionResult {
  const { handleResolveGitConflict } = useGitConflictResolution({
    activeRepo,
    startConflictResolutionSession: async (request) =>
      startSessionRequest({
        taskId: request.taskId,
        role: request.role,
        scenario: request.scenario,
        reason: "rebase_conflict_resolution",
        postStartAction: "send_message",
        message: request.message,
        initialStartMode: request.initialStartMode,
        targetWorkingDirectory: request.targetWorkingDirectory,
        ...(request.existingSessionOptions.length > 0
          ? { existingSessionOptions: request.existingSessionOptions }
          : {}),
        ...(request.initialSourceSessionId
          ? { initialSourceSessionId: request.initialSourceSessionId }
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
            ? selection.viewActiveSession.sessionId
            : null,
        onOpenSession: (sessionId) => {
          const session = builderSessions.find((entry) => entry.sessionId === sessionId);
          if (
            selection.viewActiveSession?.sessionId !== sessionId ||
            selection.viewActiveSession?.role !== "build"
          ) {
            onContextSwitchIntent();
          }
          scheduleQueryUpdate({
            task: selection.viewTaskId,
            session: sessionId,
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

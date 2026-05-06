import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  type StartGitConflictResolutionSessionInput,
  useGitConflictResolution,
} from "@/features/git-conflict-resolution";
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
  const startConflictResolutionSession = useCallback(
    async (request: StartGitConflictResolutionSessionInput) =>
      startSessionRequest({
        taskId: request.taskId,
        role: request.role,
        launchActionId: "build_rebase_conflict_resolution" as const,
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
    [startSessionRequest],
  );

  const { handleResolveGitConflict } = useGitConflictResolution({
    activeWorkspace,
    startConflictResolutionSession,
    loadPromptOverrides,
  });
  const {
    viewTaskId,
    viewSelectedTask,
    viewActiveSession,
    activeSession,
    selectedSessionById,
    viewSessionsForTask,
    sessionsForTask,
  } = selection;

  const handleResolveRebaseConflict = useCallback(
    async (conflict: GitConflict): Promise<boolean> => {
      if (!viewTaskId) {
        throw new Error("Cannot resolve a git conflict because no task is selected.");
      }

      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        taskId: viewTaskId,
        viewActiveSession,
        activeSession,
        selectedSessionById,
        viewSessionsForTask,
        sessionsForTask,
      });
      const defaultBuilderSession = resolveAgentStudioBuilderSessionForTask({
        taskId: viewTaskId,
        viewActiveSession,
        activeSession,
        selectedSessionById,
        viewSessionsForTask,
        sessionsForTask,
      });

      return handleResolveGitConflict(conflict, {
        taskId: viewTaskId,
        task: viewSelectedTask,
        builderSessions,
        currentViewSessionId:
          viewActiveSession?.role === "build" ? viewActiveSession.externalSessionId : null,
        onOpenSession: (externalSessionId) => {
          const session = builderSessions.find(
            (entry) => entry.externalSessionId === externalSessionId,
          );
          if (
            viewActiveSession?.externalSessionId !== externalSessionId ||
            viewActiveSession?.role !== "build"
          ) {
            onContextSwitchIntent();
          }
          scheduleQueryUpdate({
            task: viewTaskId,
            session: externalSessionId,
            agent: session?.role ?? defaultBuilderSession?.role ?? "build",
          });
        },
      });
    },
    [
      activeSession,
      handleResolveGitConflict,
      onContextSwitchIntent,
      scheduleQueryUpdate,
      selectedSessionById,
      sessionsForTask,
      viewActiveSession,
      viewSelectedTask,
      viewSessionsForTask,
      viewTaskId,
    ],
  );

  return {
    handleResolveRebaseConflict,
  };
}

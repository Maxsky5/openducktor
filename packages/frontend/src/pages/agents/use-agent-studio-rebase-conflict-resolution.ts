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
  SessionStartWorkflowResult,
} from "@/features/session-start";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
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
  selectedSessionFromRoute: AgentSessionSummary | null;
  viewSessionsForTask: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
};

type UseAgentStudioRebaseConflictResolutionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  selection: AgentStudioRebaseConflictResolutionSelectionContext;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  startSessionRequest: (
    request: SessionStartLaunchRequest & {
      role: "build";
      launchActionId: "build_rebase_conflict_resolution";
      postStartAction: "send_message";
      message: string;
      targetWorkingDirectory?: string | null;
      existingSessionOptions?: SessionStartExistingSessionOption[];
      initialSourceSession?: AgentSessionIdentity | null;
    },
  ) => Promise<SessionStartWorkflowResult | undefined>;
  loadPromptOverrides?: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type UseAgentStudioRebaseConflictResolutionResult = {
  handleResolveRebaseConflict: (conflict: GitConflict) => Promise<boolean>;
};

export function useAgentStudioRebaseConflictResolution({
  activeWorkspace,
  selection,
  scheduleQueryUpdate,
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
        ...(request.initialSourceSession !== undefined
          ? { initialSourceSession: request.initialSourceSession }
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
    selectedSessionFromRoute,
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
        selectedSessionById: selectedSessionFromRoute,
        viewSessionsForTask,
        sessionsForTask,
      });
      const defaultBuilderSession = resolveAgentStudioBuilderSessionForTask({
        taskId: viewTaskId,
        viewActiveSession,
        activeSession,
        selectedSessionById: selectedSessionFromRoute,
        viewSessionsForTask,
        sessionsForTask,
      });

      return handleResolveGitConflict(conflict, {
        taskId: viewTaskId,
        task: viewSelectedTask,
        builderSessions,
        currentViewSession: viewActiveSession?.role === "build" ? viewActiveSession : null,
        onOpenSession: (session) => {
          const builderSession =
            builderSessions.find((entry) => matchesAgentSessionIdentity(entry, session)) ?? null;
          scheduleQueryUpdate({
            task: viewTaskId,
            session: session.externalSessionId,
            agent: builderSession?.role ?? defaultBuilderSession?.role ?? "build",
          });
        },
      });
    },
    [
      activeSession,
      handleResolveGitConflict,
      scheduleQueryUpdate,
      selectedSessionFromRoute,
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

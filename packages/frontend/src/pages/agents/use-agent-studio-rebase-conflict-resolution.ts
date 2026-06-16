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
import { agentSessionIdentityKey, matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import { resolveAgentStudioBuilderSessionsForTask } from "./agents-page-selection";
import type { AgentStudioQueryUpdate } from "./query-sync/agent-studio-navigation";

type AgentStudioRebaseConflictResolutionSelectionContext = {
  view: {
    taskId: string;
    selectedTask: TaskCard | null;
    activeSession: AgentSessionSummary | null;
    sessionsForTask: AgentSessionSummary[];
  };
  activeSession: AgentSessionSummary | null;
  selectedSessionFromRoute: AgentSessionSummary | null;
  sessionsForTask: AgentSessionSummary[];
};

type UseAgentStudioRebaseConflictResolutionArgs = {
  workspaceId: string | null;
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
  workspaceId,
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
    workspaceId,
    startConflictResolutionSession,
    loadPromptOverrides,
  });
  const { view, activeSession, selectedSessionFromRoute, sessionsForTask } = selection;

  const handleResolveRebaseConflict = useCallback(
    async (conflict: GitConflict): Promise<boolean> => {
      if (!view.taskId) {
        throw new Error("Cannot resolve a git conflict because no task is selected.");
      }

      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        taskId: view.taskId,
        candidateSessions: [
          view.activeSession,
          activeSession,
          selectedSessionFromRoute,
          ...view.sessionsForTask,
          ...sessionsForTask,
        ],
      });
      const defaultBuilderSession = builderSessions[0] ?? null;

      return handleResolveGitConflict(conflict, {
        taskId: view.taskId,
        task: view.selectedTask,
        builderSessions,
        currentViewSession: view.activeSession?.role === "build" ? view.activeSession : null,
        onOpenSession: (session) => {
          const builderSession =
            builderSessions.find((entry) => matchesAgentSessionIdentity(entry, session)) ?? null;
          scheduleQueryUpdate({
            task: view.taskId,
            session: agentSessionIdentityKey(session),
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
      view,
    ],
  );

  return {
    handleResolveRebaseConflict,
  };
}

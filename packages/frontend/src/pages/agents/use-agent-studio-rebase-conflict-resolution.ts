import type { RepoPromptOverrides } from "@openducktor/contracts";
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
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import { resolveAgentStudioBuilderSessionsForTask } from "./agents-page-selection";
import type { AgentStudioQueryUpdate } from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";

type AgentStudioRebaseConflictResolutionSelectionContext = {
  view: Pick<
    AgentStudioSelectionControllerResult["view"],
    "taskId" | "role" | "selectedTask" | "selectedSession" | "sessionsForTask"
  >;
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
  const { view } = selection;

  const handleResolveRebaseConflict = useCallback(
    async (conflict: GitConflict): Promise<boolean> => {
      if (!view.taskId) {
        throw new Error("Cannot resolve a git conflict because no task is selected.");
      }

      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        taskId: view.taskId,
        candidateSessions: [view.selectedSession.loadedSession, ...view.sessionsForTask],
      });
      const defaultBuilderSession = builderSessions[0] ?? null;

      return handleResolveGitConflict(conflict, {
        taskId: view.taskId,
        task: view.selectedTask,
        builderSessions,
        currentViewSession: view.role === "build" ? view.selectedSession.identity : null,
        onOpenSession: (session) => {
          const builderSession =
            builderSessions.find((entry) => matchesAgentSessionIdentity(entry, session)) ?? null;
          scheduleQueryUpdate({
            task: view.taskId,
            session: session.externalSessionId,
            agent: builderSession?.role ?? defaultBuilderSession?.role ?? "build",
          });
        },
      });
    },
    [handleResolveGitConflict, scheduleQueryUpdate, view],
  );

  return {
    handleResolveRebaseConflict,
  };
}

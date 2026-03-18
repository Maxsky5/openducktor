import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  type GitConflictResolutionDecision,
  type PendingGitConflictResolutionRequest,
  useGitConflictResolution,
} from "@/features/git-conflict-resolution";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import {
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
} from "./agents-page-selection";

export type RebaseConflictResolutionDecision = GitConflictResolutionDecision;
export type PendingRebaseConflictResolutionRequest = PendingGitConflictResolutionRequest;

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
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  loadPromptOverrides?: (repoPath: string) => Promise<RepoPromptOverrides>;
};

type UseAgentStudioRebaseConflictResolutionResult = {
  pendingRebaseConflictResolutionRequest: PendingRebaseConflictResolutionRequest | null;
  resolvePendingRebaseConflictResolution: (decision: RebaseConflictResolutionDecision) => void;
  handleResolveRebaseConflict: (conflict: GitConflict) => Promise<boolean>;
};

export function useAgentStudioRebaseConflictResolution({
  activeRepo,
  selection,
  scheduleQueryUpdate,
  onContextSwitchIntent,
  startAgentSession,
  sendAgentMessage,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseAgentStudioRebaseConflictResolutionArgs): UseAgentStudioRebaseConflictResolutionResult {
  const {
    pendingGitConflictResolutionRequest,
    resolvePendingGitConflictResolution,
    handleResolveGitConflict,
  } = useGitConflictResolution({
    activeRepo,
    startAgentSession,
    sendAgentMessage,
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
    pendingRebaseConflictResolutionRequest: pendingGitConflictResolutionRequest,
    resolvePendingRebaseConflictResolution: resolvePendingGitConflictResolution,
    handleResolveRebaseConflict,
  };
}

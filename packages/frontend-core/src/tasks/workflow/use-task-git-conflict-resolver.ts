import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  type GitConflictAssistanceResult,
  GitConflictRequestCancelled,
} from "../../git/conflicts/conflict-assistance";
import {
  toConflictResolutionStartRequest,
  useGitConflictResolution,
} from "../../git/conflicts/use-git-conflict-resolution";
import type { GitConflict } from "../../git/contracts";
import { toAgentSessionIdentity } from "../../lib/agent-session-identity";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import { useAgentMessageSendPolicy } from "../../sessions/send/use-agent-message-send-policy";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { UseTaskSessionStartFlowResult } from "./use-task-session-start-flow";

type UseTaskGitConflictResolverArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  startSessionIntent: UseTaskSessionStartFlowResult["startSessionIntent"];
  /** Opens the Builder session that received the conflict request. */
  openBuilderSession: (taskId: string, session: AgentSessionIdentity) => void;
};

/**
 * Asks a Builder of the task to resolve a Git conflict. A workspace change cancels a request
 * that started before it, so the request never reaches a Builder of another workspace.
 */
export function useTaskGitConflictResolver({
  activeWorkspaceId,
  workspaceRepoPath,
  tasks,
  sessions,
  startSessionIntent,
  openBuilderSession,
}: UseTaskGitConflictResolverArgs): (
  conflict: GitConflict,
  taskId: string,
) => Promise<GitConflictAssistanceResult> {
  const assertSessionCanSend = useAgentMessageSendPolicy();
  const conflictWorkspaceKey = JSON.stringify([activeWorkspaceId, workspaceRepoPath]);
  const conflictWorkspace = useRef({ key: conflictWorkspaceKey, version: 0 });
  useLayoutEffect(() => {
    if (conflictWorkspace.current.key !== conflictWorkspaceKey)
      conflictWorkspace.current = {
        key: conflictWorkspaceKey,
        version: conflictWorkspace.current.version + 1,
      };
  }, [conflictWorkspaceKey]);
  const { handleResolveGitConflict } = useGitConflictResolution({
    workspaceId: activeWorkspaceId,
    startConflictResolutionSession: (request) =>
      startSessionIntent(toConflictResolutionStartRequest(request)),
  });
  return useCallback(
    (conflict: GitConflict, taskId: string) => {
      const version = conflictWorkspace.current.version;
      const assertCurrent = () => {
        if (conflictWorkspace.current.version !== version) throw new GitConflictRequestCancelled();
      };
      const task = tasks.find((entry) => entry.id === taskId) ?? null;
      const builderSessions = sessions.filter(
        (entry) => entry.role === "build" && entry.taskId === taskId,
      );
      return handleResolveGitConflict(
        conflict,
        {
          taskId,
          task,
          builderSessions,
          currentViewSession: null,
          onOpenSession: (session) => {
            if (!activeWorkspaceId) {
              throw new Error("No active workspace is selected.");
            }
            openBuilderSession(taskId, toAgentSessionIdentity(session));
          },
        },
        assertSessionCanSend,
        assertCurrent,
      );
    },
    [
      activeWorkspaceId,
      assertSessionCanSend,
      handleResolveGitConflict,
      openBuilderSession,
      sessions,
      tasks,
    ],
  );
}

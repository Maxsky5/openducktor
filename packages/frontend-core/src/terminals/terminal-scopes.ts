import type { WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { taskWorktreeQueryOptions } from "../queries/build-runtime";
import type { TerminalScope } from "./use-terminals";

export type TaskTerminalScopeInput = {
  /** The key of the scope in the client, such as its panel owner key. */
  key: string | null;
  repoPath: string | null;
  taskId: string | null;
  /** The task version, so a task change reads its worktree again. */
  taskVersion: string | null;
};

export type TaskTerminalScope = {
  /** The scope, or null without a task. */
  scope: TerminalScope | null;
  /** The task worktree is loading, so terminals cannot start yet. */
  isScopeLoading: boolean;
  /** Why the task worktree read failed, or null. Terminal discovery shows it with a retry. */
  scopeError: string | null;
  /** Reads the task worktree again. */
  retryScope: () => void;
};

/** The terminal scope of a task. Its terminals start in the task worktree. */
export const useTaskTerminalScope = ({
  key,
  repoPath,
  taskId,
  taskVersion,
}: TaskTerminalScopeInput): TaskTerminalScope => {
  const enabled = key !== null && repoPath !== null && taskId !== null;
  const worktreeOptions = enabled
    ? taskWorktreeQueryOptions({ repoPath, taskId, taskVersion })
    : taskWorktreeQueryOptions({ repoPath: "disabled", taskId: "disabled" });
  const worktreeQuery = useQuery({ ...worktreeOptions, enabled });
  const workingDirectory = worktreeQuery.data?.workingDirectory ?? null;
  // A failed refresh keeps the worktree that the last read found.
  const scopeError =
    worktreeQuery.isError && worktreeQuery.data === undefined
      ? `Could not read the worktree of task ${taskId}: ${worktreeQuery.error.message}`
      : null;
  const scope = useMemo((): TerminalScope | null => {
    if (key === null || repoPath === null || taskId === null) return null;
    return {
      key,
      context: { repoPath, taskId },
      workingDirectory,
      workingDirectoryError: scopeError ?? `Task ${taskId} has no available worktree.`,
    };
  }, [key, repoPath, scopeError, taskId, workingDirectory]);
  const { refetch } = worktreeQuery;
  const retryScope = useCallback((): void => {
    if (enabled) void refetch();
  }, [enabled, refetch]);
  return { scope, isScopeLoading: worktreeQuery.isLoading, scopeError, retryScope };
};

/** The terminal scope of a chat. Its terminals start in the saved chat directory. */
export const workspaceSessionTerminalScope = ({
  key,
  workspaceId,
  repoPath,
  record,
}: {
  key: string;
  workspaceId: string;
  repoPath: string;
  record: WorkspaceSession;
}): TerminalScope => ({
  key,
  context: { kind: "workspace_session", workspaceId, sessionId: record.id, repoPath },
  ...chatWorkingDirectory(record),
});

function chatWorkingDirectory(
  record: WorkspaceSession,
): Pick<TerminalScope, "workingDirectory" | "workingDirectoryError"> {
  if (record.archivedAt !== null) {
    return {
      workingDirectory: null,
      workingDirectoryError: "This chat is archived. Restore the chat to use terminals.",
    };
  }
  const target = record.executionTarget;
  if (target.kind === "local_worktree" && target.worktreeState === "removed") {
    return {
      workingDirectory: null,
      workingDirectoryError:
        "The worktree of this chat was removed. Restore the chat to create the worktree again.",
    };
  }
  return {
    workingDirectory: target.workingDirectory,
    workingDirectoryError: "This chat has no saved directory. Reopen or restore the chat.",
  };
}

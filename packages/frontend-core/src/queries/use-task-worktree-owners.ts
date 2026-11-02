import type { TaskWorktreeOwnersOperation, WorktreeOwners } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useActiveWorkspaceContext } from "../app-state/app-state-contexts";
import { errorMessage } from "../lib/errors";
import { taskWorktreeOwnersQueryOptions } from "./task-worktree-owners";

/** The owner read of one confirmation. Without a worktree removal, it reads nothing. */
export type TaskWorktreeOwnersRead = {
  /** Null until the read ends, or when the action removes no worktree. */
  owners: WorktreeOwners | null;
  /** The saved Claude chats whose native history the host could not read. They only warn. */
  historyReadErrors: string[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
};

/**
 * Reads the others that need a worktree that the action removes. Only an open confirmation that
 * removes a worktree reads them, because the read checks the saved chats of every workspace.
 */
export function useTaskWorktreeOwners({
  taskIds,
  operation,
  enabled,
}: {
  taskIds: string[];
  operation: TaskWorktreeOwnersOperation;
  enabled: boolean;
}): TaskWorktreeOwnersRead {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const repoPath = activeWorkspace?.repoPath ?? null;
  const shouldRead = enabled && repoPath !== null && taskIds.length > 0;
  const query = useQuery({
    ...taskWorktreeOwnersQueryOptions({
      workspaceId: activeWorkspace?.workspaceId ?? "disabled",
      repoPath: repoPath ?? "",
      taskIds,
      operation,
    }),
    enabled: shouldRead,
  });
  const retry = () => {
    void query.refetch();
  };
  // A read that the action no longer needs, such as a close that keeps its worktree, shows nothing.
  if (!shouldRead)
    return { owners: null, historyReadErrors: [], isLoading: false, error: null, retry };
  return {
    owners: query.data?.owners ?? null,
    historyReadErrors: query.data?.historyReadErrors ?? [],
    isLoading: query.isPending || query.isFetching,
    error: query.isError ? errorMessage(query.error) : null,
    retry,
  };
}

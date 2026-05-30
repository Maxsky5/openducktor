import type { QueryClient } from "@tanstack/react-query";
import { getCachedWorktreeStatusFromQuery } from "@/state/queries/git";
import type { ScopeSnapshot } from "../model/diff-data-model";
import { toScopeSnapshot } from "../model/normalization";
import type { LoadRequestContext } from "./use-diff-batch-state";

export const readCachedFullLoadSnapshot = (
  queryClient: QueryClient,
  { repoPath, scope, targetBranch, workingDir }: LoadRequestContext,
): ScopeSnapshot | null => {
  // Worktree contexts are task-keyed; repository-mode branch identity is tracked outside this query key.
  if (workingDir === null) {
    return null;
  }

  const cachedStatus = getCachedWorktreeStatusFromQuery(
    queryClient,
    repoPath,
    targetBranch,
    scope,
    workingDir,
  );

  return cachedStatus === undefined ? null : toScopeSnapshot(cachedStatus);
};

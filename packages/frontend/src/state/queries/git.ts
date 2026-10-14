import type {
  GitBranch,
  GitCurrentBranch,
  GitComparisonTarget,
  GitHistoryPage,
  GitHistoryPageRequest,
  GitLocalChanges,
  GitTargetBranch,
  GitWorktreeStatus,
} from "@openducktor/contracts";
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "./skipped-query";
import { workspaceReadContext } from "./workspace-refresh";
import { hostClient as host } from "@/lib/host-client";

type GitBranchesQueryHost = Pick<typeof host, "gitGetBranches">;
type GitCurrentBranchQueryHost = Pick<typeof host, "gitGetCurrentBranch">;
type GitComparisonTargetQueryHost = Pick<typeof host, "gitGetComparisonTarget">;
type GitWorktreeStatusQueryHost = Pick<typeof host, "gitGetWorktreeStatus">;
type GitLocalChangesQueryHost = Pick<typeof host, "gitGetLocalChanges">;
type GitHistoryQueryHost = Pick<typeof host, "gitGetHistoryPage">;

const BRANCH_DATA_STALE_TIME_MS = 60_000;
const WORKTREE_STATUS_STALE_TIME_MS = 0;

export const gitQueryKeys = {
  all: ["git"] as const,
  canonicalPath: (path: string) => [...gitQueryKeys.all, "canonical-path", path] as const,
  branches: (repoPath: string) => [...gitQueryKeys.all, "branches", repoPath] as const,
  currentBranch: (repoPath: string) => [...gitQueryKeys.all, "current-branch", repoPath] as const,
  worktreeBranch: (repoPath: string, workingDir: string) =>
    [...gitQueryKeys.all, "worktree-branch", repoPath, workingDir] as const,
  comparisonTarget: (
    repoPath: string,
    workingDir: string,
    target: GitTargetBranch,
    branchKey: string,
  ) =>
    [
      ...gitQueryKeys.all,
      "comparison-target",
      repoPath,
      workingDir,
      target.remote ?? "",
      target.branch,
      branchKey,
    ] as const,
  worktreeStatus: (
    repoPath: string,
    targetBranch: string,
    workingDir: string | null,
    branchKey = "",
  ) =>
    [
      ...gitQueryKeys.all,
      "worktree-status",
      repoPath,
      targetBranch,
      workingDir ?? repoPath,
      branchKey,
    ] as const,
  localChanges: (repoPath: string, workingDir: string | null, branchKey = "") =>
    [...gitQueryKeys.all, "local-changes", repoPath, workingDir ?? repoPath, branchKey] as const,
  history: (
    repoPath: string,
    workingDir: string,
    checkout: GitCurrentBranch,
    targetReference: string,
  ) =>
    [
      ...gitQueryKeys.all,
      "history",
      repoPath,
      workingDir,
      targetReference,
      checkout.name ?? "",
      checkout.detached,
      checkout.revision ?? "",
    ] as const,
};

export const canonicalPathQueryOptions = (
  path: string,
  hostClient: Pick<typeof host, "gitCanonicalizePath"> = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.canonicalPath(path),
    queryFn: () => hostClient.gitCanonicalizePath(path),
    staleTime: 0,
  });

export const repoBranchesQueryOptions = (
  repoPath: string,
  hostClient: GitBranchesQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.branches(repoPath),
    queryFn: (): Promise<GitBranch[]> => hostClient.gitGetBranches(repoPath),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
  });

export const currentBranchQueryOptions = (
  repoPath: string,
  hostClient: GitCurrentBranchQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.currentBranch(repoPath),
    queryFn: ({ client }): Promise<GitCurrentBranch> =>
      readCurrentBranch(client, repoPath, undefined, hostClient),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
  });

export const worktreeBranchQueryOptions = (
  repoPath: string,
  workingDir: string,
  hostClient: GitCurrentBranchQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.worktreeBranch(repoPath, workingDir),
    queryFn: ({ client }): Promise<GitCurrentBranch> =>
      readCurrentBranch(client, repoPath, workingDir, hostClient),
    staleTime: 0,
  });

export const gitComparisonTargetQueryOptions = (
  repoPath: string,
  workingDir: string,
  target: GitTargetBranch,
  branchKey: string,
  hostClient: GitComparisonTargetQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.comparisonTarget(repoPath, workingDir, target, branchKey),
    queryFn: ({ signal }): Promise<GitComparisonTarget> => {
      signal.throwIfAborted();
      return hostClient.gitGetComparisonTarget(repoPath, workingDir, target);
    },
    staleTime: 0,
  });

/**
 * The Git reads of one working directory: local changes, Branch changes, History, and the
 * comparison check. With `branch`, also the checkout read of the directory.
 */
const gitWorkingDirectoryFilter = (
  repoPath: string,
  workingDir: string,
  { branch }: { branch: boolean },
) => ({
  queryKey: gitQueryKeys.all,
  predicate: (query: { queryKey: readonly unknown[] }) => {
    const key = query.queryKey;
    if (key[2] !== repoPath) return false;
    if (key[1] === "comparison-target") return key[3] === workingDir;
    if (key[1] === "local-changes" || key[1] === "history") return key[3] === workingDir;
    if (key[1] === "worktree-status") return key[4] === workingDir;
    if (!branch) return false;
    if (key[1] === "worktree-branch") return key[3] === workingDir;
    return key[1] === "current-branch" && workingDir === repoPath;
  },
});

export const invalidateGitWorkingDirectoryQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  workingDir: string,
): Promise<void> => {
  const filter = gitWorkingDirectoryFilter(repoPath, workingDir, { branch: false });
  // An old read must not make an invalidated branch snapshot fresh again.
  await queryClient.cancelQueries(filter);
  await queryClient.invalidateQueries({ ...filter, refetchType: "none" });
};

/**
 * Marks the Git reads of a directory stale without reading. A view that shows the directory later
 * reads again. A read that runs now started after the change, so it can finish.
 */
export const markGitWorkingDirectoryStale = (
  queryClient: QueryClient,
  repoPath: string,
  workingDir: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    ...gitWorkingDirectoryFilter(repoPath, workingDir, { branch: false }),
    refetchType: "none",
  });

/**
 * An agent changed a directory, for example in a turn that the user did not watch. A view that
 * shows the directory reads its checkout and Git data again now. Other views read when they show.
 */
export const refreshGitAfterAgentChange = async (
  queryClient: QueryClient,
  repoPath: string,
  workingDir: string,
): Promise<void> => {
  const filter = gitWorkingDirectoryFilter(repoPath, workingDir, { branch: true });
  // A hidden read that started before the change must not mark its old result fresh.
  await queryClient.cancelQueries({ ...filter, type: "inactive" });
  await queryClient.invalidateQueries({ ...filter, refetchType: "active" });
};

/** Branch changes: the comparison of the working content with the target. */
export const worktreeStatusQueryOptions = (
  repoPath: string,
  targetBranch: string,
  workingDir: string | null,
  branchKey = "",
  hostClient: GitWorktreeStatusQueryHost = host,
) =>
  // A plain key type lets a view swap these options for the skipped options.
  queryOptions<GitWorktreeStatus, Error, GitWorktreeStatus, QueryKey>({
    queryKey: gitQueryKeys.worktreeStatus(repoPath, targetBranch, workingDir, branchKey),
    queryFn: ({ client }): Promise<GitWorktreeStatus> => {
      const args: Parameters<GitWorktreeStatusQueryHost["gitGetWorktreeStatus"]> = [
        repoPath,
        targetBranch,
        "target",
        workingDir ?? undefined,
      ];
      const readContext = workspaceReadContext(client, workingDir ?? repoPath);
      if (readContext) args.push(readContext);
      return hostClient.gitGetWorktreeStatus(...args);
    },
    staleTime: WORKTREE_STATUS_STALE_TIME_MS,
  });

export const localChangesQueryOptions = (
  repoPath: string,
  workingDir: string | null,
  branchKey: string,
  hostClient: GitLocalChangesQueryHost = host,
) =>
  queryOptions<GitLocalChanges, Error, GitLocalChanges, QueryKey>({
    queryKey: gitQueryKeys.localChanges(repoPath, workingDir, branchKey),
    queryFn: ({ client }): Promise<GitLocalChanges> =>
      hostClient.gitGetLocalChanges(
        repoPath,
        workingDir ?? undefined,
        workspaceReadContext(client, workingDir ?? repoPath),
      ),
    staleTime: WORKTREE_STATUS_STALE_TIME_MS,
  });

/** A local changes read with no repository. Its key matches no live read. */
export const skippedLocalChangesQueryOptions = () =>
  skippedQueryOptions<GitLocalChanges>({
    queryKey: [...gitQueryKeys.all, "local-changes", SKIPPED_QUERY_KEY_SEGMENT],
    staleTime: Number.POSITIVE_INFINITY,
  });

/** A Branch changes read before the comparison is ready. Its key matches no live read. */
export const skippedWorktreeStatusQueryOptions = () =>
  skippedQueryOptions<GitWorktreeStatus>({
    queryKey: [...gitQueryKeys.all, "worktree-status", SKIPPED_QUERY_KEY_SEGMENT],
    staleTime: Number.POSITIVE_INFINITY,
  });

type GitHistoryPageParam = NonNullable<GitHistoryPageRequest["page"]> | null;

/**
 * True when a History read continues the shown graph: the same directory and target, and the same
 * branch or a detached HEAD on either side. A rebase detaches HEAD from its branch and attaches it
 * again at the end, so its graph updates in place. Another branch starts without rows.
 */
const continuesHistory = (previous: readonly unknown[], next: readonly unknown[]): boolean => {
  // The key ends with the branch name, the detached flag, and the revision.
  const scope = (key: readonly unknown[]) => JSON.stringify(key.slice(0, -3));
  const [previousName, previousDetached] = previous.slice(-3);
  const [nextName, nextDetached] = next.slice(-3);
  return (
    scope(previous) === scope(next) &&
    (previousDetached === true || nextDetached === true || previousName === nextName)
  );
};

/**
 * Each page keeps the tips that the first page read, so rows stay in one graph. A new commit of
 * the branch, or a rebase of it, keeps the shown graph until the new graph loads, so the list
 * updates in place.
 */
export const gitHistoryQueryOptions = (
  input: {
    repoPath: string;
    workingDir: string;
    checkout: GitCurrentBranch;
    targetReference: string;
  },
  hostClient: GitHistoryQueryHost = host,
) => {
  const queryKey = gitQueryKeys.history(
    input.repoPath,
    input.workingDir,
    input.checkout,
    input.targetReference,
  );
  return infiniteQueryOptions<
    GitHistoryPage,
    Error,
    InfiniteData<GitHistoryPage, GitHistoryPageParam>,
    ReturnType<typeof gitQueryKeys.history>,
    GitHistoryPageParam
  >({
    queryKey,
    placeholderData: (previous, previousQuery) =>
      previousQuery && continuesHistory(previousQuery.queryKey, queryKey) ? previous : undefined,
    queryFn: ({ pageParam }): Promise<GitHistoryPage> => {
      const request: GitHistoryPageRequest = {
        repoPath: input.repoPath,
        workingDir: input.workingDir,
        targetReference: input.targetReference,
        expectedBranch: input.checkout,
      };
      if (pageParam) request.page = pageParam;
      return hostClient.gitGetHistoryPage(request);
    },
    initialPageParam: null,
    getNextPageParam: (page): GitHistoryPageParam =>
      page.outcome === "page" && page.nextOffset !== null
        ? {
            currentTip: page.comparison.currentTip,
            targetTip: page.comparison.targetTip,
            offset: page.nextOffset,
          }
        : null,
    staleTime: Number.POSITIVE_INFINITY,
  });
};

/**
 * Reads History again for a directory. A view that shows History reads at once.
 * With `throwOnError`, the result rejects when one of those reads fails.
 */
export const refreshGitHistoryQueries = (
  queryClient: QueryClient,
  repoPath: string,
  workingDir: string,
  options: { throwOnError: boolean },
): Promise<void> =>
  queryClient.invalidateQueries(
    {
      queryKey: gitQueryKeys.all,
      predicate: (query) =>
        query.queryKey[1] === "history" &&
        query.queryKey[2] === repoPath &&
        query.queryKey[3] === workingDir,
    },
    options,
  );

export const loadRepoBranchesFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  hostClient?: GitBranchesQueryHost,
): Promise<GitBranch[]> => queryClient.fetchQuery(repoBranchesQueryOptions(repoPath, hostClient));

export const invalidateRepoBranchesQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: gitQueryKeys.branches(repoPath),
    exact: true,
    refetchType: "none",
  });

export const loadCurrentBranchFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  hostClient?: GitCurrentBranchQueryHost,
): Promise<GitCurrentBranch> =>
  queryClient.fetchQuery(currentBranchQueryOptions(repoPath, hostClient));

export const invalidateCurrentBranchQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: gitQueryKeys.currentBranch(repoPath),
    exact: true,
    refetchType: "none",
  });

async function readCurrentBranch(
  client: QueryClient,
  repoPath: string,
  workingDir: string | undefined,
  hostClient: GitCurrentBranchQueryHost,
): Promise<GitCurrentBranch> {
  const key =
    workingDir === undefined
      ? gitQueryKeys.currentBranch(repoPath)
      : gitQueryKeys.worktreeBranch(repoPath, workingDir);
  const before = client.getQueryData<GitCurrentBranch>(key);
  const args: Parameters<GitCurrentBranchQueryHost["gitGetCurrentBranch"]> = [repoPath];
  if (workingDir !== undefined) args.push(workingDir);
  const branch = await hostClient.gitGetCurrentBranch(...args);
  if (
    before &&
    (before.name !== branch.name ||
      before.detached !== branch.detached ||
      before.revision !== branch.revision)
  ) {
    await invalidateGitWorkingDirectoryQueries(client, repoPath, workingDir ?? repoPath);
  }
  return branch;
}

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
  hashKey,
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  type QueryKey,
  type QueryMeta,
  queryOptions,
} from "@tanstack/react-query";
import "./query-meta";
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

/**
 * The checkout part of a Git read key: the branch name, or one value for any detached HEAD.
 * A commit or a rebase step keeps it, so the panel keeps its data while the reads run again.
 * Another branch gets reads of its own.
 */
export const checkoutReadIdentity = (
  branch: GitCurrentBranch | null | undefined,
): string | null => {
  if (!branch) return null;
  if (branch.detached) return "detached";
  return branch.name != null ? `branch:${branch.name}` : null;
};

/** A rebase detaches HEAD and attaches it again, so a detached HEAD continues any checkout. */
const continuesCheckout = (previous: string | null | undefined, next: string | null): boolean =>
  previous === next || previous === "detached" || next === "detached";

/**
 * The query options of a directory read whose key ends with its checkout. A read under a new key
 * that continues the shown checkout, such as a rebase step, keeps the shown result until its own
 * result arrives, so the panel updates in place. Another branch starts without data.
 */
export const continuedCheckoutRead = (queryKey: QueryKey, checkoutIdentity: string | null) => {
  const scope = hashKey(queryKey.slice(0, -1));
  return {
    meta: { checkoutIdentity },
    placeholderData: <T>(
      previous: T | undefined,
      previousQuery: { queryKey: QueryKey; meta: QueryMeta | undefined } | undefined,
    ): T | undefined =>
      previousQuery &&
      hashKey(previousQuery.queryKey.slice(0, -1)) === scope &&
      continuesCheckout(previousQuery.meta?.checkoutIdentity, checkoutIdentity)
        ? previous
        : undefined,
  };
};

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
 * A commit or a rebase step on the same checkout keeps the read keys, so the shown reads read
 * again. A read that started before the change cannot keep its old result: a shown read starts
 * over, and a hidden read stops and reads when it shows. History keys hold the revision, so
 * History reads under its new key by itself.
 */
const refreshCheckoutContent = async (
  queryClient: QueryClient,
  repoPath: string,
  workingDir: string,
): Promise<void> => {
  const { queryKey, predicate } = gitWorkingDirectoryFilter(repoPath, workingDir, {
    branch: false,
  });
  const filter = {
    queryKey,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[1] !== "history" && predicate(query),
  };
  await queryClient.cancelQueries({ ...filter, type: "inactive" });
  // The branch read returns now. Each view shows its own failed read.
  void queryClient.invalidateQueries({ ...filter, refetchType: "active" });
};

/**
 * Reads the checkout and the Git data of a directory again, for example after an agent turn that
 * the user did not watch. A view that shows the directory reads now, and other views read when
 * they show. The shown data stays until the new results arrive.
 */
export const refreshGitWorkingDirectory = async (
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
    const directory = workingDir ?? repoPath;
    const identity = checkoutReadIdentity(branch);
    if (checkoutReadIdentity(before) === identity) {
      await refreshCheckoutContent(client, repoPath, directory);
    } else {
      // Another checkout reads under keys of its own when the view shows it.
      await invalidateGitWorkingDirectoryQueries(client, repoPath, directory);
      // Reads from an earlier visit to the new checkout predate this change. Without them, the
      // view shows the reads that it continues until its own reads arrive.
      const { queryKey, predicate } = gitWorkingDirectoryFilter(repoPath, directory, {
        branch: false,
      });
      client.removeQueries({
        queryKey,
        type: "inactive",
        predicate: (query) => query.meta?.checkoutIdentity === identity && predicate(query),
      });
    }
  }
  return branch;
}

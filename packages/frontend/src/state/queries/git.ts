import type {
  GitBranch,
  GitCurrentBranch,
  GitComparisonTarget,
  GitTargetBranch,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";

type GitBranchesQueryHost = Pick<typeof host, "gitGetBranches">;
type GitCurrentBranchQueryHost = Pick<typeof host, "gitGetCurrentBranch">;
type GitComparisonTargetQueryHost = Pick<typeof host, "gitGetComparisonTarget">;
type GitWorktreeStatusQueryHost = Pick<typeof host, "gitGetWorktreeStatus">;
type GitWorktreeStatusSummaryQueryHost = Pick<typeof host, "gitGetWorktreeStatusSummary">;

const BRANCH_DATA_STALE_TIME_MS = 60_000;
const WORKTREE_STATUS_STALE_TIME_MS = 0;

export const gitQueryKeys = {
  all: ["git"] as const,
  canonicalPath: (path: string) => [...gitQueryKeys.all, "canonical-path", path] as const,
  branches: (repoPath: string) => [...gitQueryKeys.all, "branches", repoPath] as const,
  currentBranch: (repoPath: string) => [...gitQueryKeys.all, "current-branch", repoPath] as const,
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
    diffScope: "target" | "uncommitted",
    workingDir: string | null,
  ) =>
    [
      ...gitQueryKeys.all,
      "worktree-status",
      repoPath,
      targetBranch,
      diffScope,
      workingDir ?? "",
    ] as const,
  worktreeStatusSummary: (
    repoPath: string,
    targetBranch: string,
    diffScope: "target" | "uncommitted",
    workingDir: string | null,
  ) =>
    [
      ...gitQueryKeys.all,
      "worktree-status-summary",
      repoPath,
      targetBranch,
      diffScope,
      workingDir ?? "",
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
    queryFn: (): Promise<GitCurrentBranch> => hostClient.gitGetCurrentBranch(repoPath),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
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
    queryFn: (): Promise<GitComparisonTarget> =>
      hostClient.gitGetComparisonTarget(repoPath, workingDir, target),
    staleTime: 0,
  });

export const invalidateGitWorkingDirectoryQueries = (
  queryClient: QueryClient,
  repoPath: string,
  workingDir: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: gitQueryKeys.all,
    predicate: (query) => {
      const key = query.queryKey;
      if (key[2] !== repoPath) return false;
      if (key[1] === "comparison-target") return key[3] === workingDir;
      if (key[1] === "worktree-status" || key[1] === "worktree-status-summary") {
        return key[5] === workingDir;
      }
      return false;
    },
    refetchType: "none",
  });

const worktreeStatusQueryOptions = (
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
  hostClient: GitWorktreeStatusQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.worktreeStatus(repoPath, targetBranch, diffScope, workingDir),
    queryFn: (): Promise<GitWorktreeStatus> =>
      hostClient.gitGetWorktreeStatus(repoPath, targetBranch, diffScope, workingDir ?? undefined),
    staleTime: WORKTREE_STATUS_STALE_TIME_MS,
  });

const worktreeStatusSummaryQueryOptions = (
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
  hostClient: GitWorktreeStatusSummaryQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.worktreeStatusSummary(repoPath, targetBranch, diffScope, workingDir),
    queryFn: (): Promise<GitWorktreeStatusSummary> =>
      hostClient.gitGetWorktreeStatusSummary(
        repoPath,
        targetBranch,
        diffScope,
        workingDir ?? undefined,
      ),
    staleTime: WORKTREE_STATUS_STALE_TIME_MS,
  });

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

export const loadWorktreeStatusFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
  options?: {
    force?: boolean;
  },
  hostClient?: GitWorktreeStatusQueryHost,
): Promise<GitWorktreeStatus> => {
  const queryKey = gitQueryKeys.worktreeStatus(repoPath, targetBranch, diffScope, workingDir);

  if (options?.force === true) {
    void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  }

  return queryClient.fetchQuery({
    ...worktreeStatusQueryOptions(repoPath, targetBranch, diffScope, workingDir, hostClient),
    staleTime: options?.force === true ? 0 : WORKTREE_STATUS_STALE_TIME_MS,
  });
};

export const getCachedWorktreeStatusFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
): GitWorktreeStatus | undefined =>
  queryClient.getQueryData(
    gitQueryKeys.worktreeStatus(repoPath, targetBranch, diffScope, workingDir),
  );

export const loadWorktreeStatusSummaryFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
  options?: {
    force?: boolean;
  },
  hostClient?: GitWorktreeStatusSummaryQueryHost,
): Promise<GitWorktreeStatusSummary> => {
  const queryKey = gitQueryKeys.worktreeStatusSummary(
    repoPath,
    targetBranch,
    diffScope,
    workingDir,
  );

  if (options?.force === true) {
    void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  }

  return queryClient.fetchQuery({
    ...worktreeStatusSummaryQueryOptions(repoPath, targetBranch, diffScope, workingDir, hostClient),
    staleTime: options?.force === true ? 0 : WORKTREE_STATUS_STALE_TIME_MS,
  });
};

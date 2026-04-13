import type {
  GitBranch,
  GitCurrentBranch,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";

type GitBranchesQueryHost = Pick<typeof host, "gitGetBranches">;
type GitCurrentBranchQueryHost = Pick<typeof host, "gitGetCurrentBranch">;
type GitWorktreeStatusQueryHost = Pick<typeof host, "gitGetWorktreeStatus">;
type GitWorktreeStatusSummaryQueryHost = Pick<typeof host, "gitGetWorktreeStatusSummary">;

const BRANCH_DATA_STALE_TIME_MS = 60_000;
const WORKTREE_STATUS_STALE_TIME_MS = 5_000;

export const gitQueryKeys = {
  all: ["git"] as const,
  branches: (repoPath: string) => [...gitQueryKeys.all, "branches", repoPath] as const,
  currentBranch: (repoPath: string) => [...gitQueryKeys.all, "current-branch", repoPath] as const,
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

export const repoBranchesQueryOptions = (
  repoPath: string,
  hostClient: GitBranchesQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.branches(repoPath),
    queryFn: (): Promise<GitBranch[]> => hostClient.gitGetBranches(repoPath),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
  });

const currentBranchQueryOptions = (
  repoPath: string,
  hostClient: GitCurrentBranchQueryHost = host,
) =>
  queryOptions({
    queryKey: gitQueryKeys.currentBranch(repoPath),
    queryFn: (): Promise<GitCurrentBranch> => hostClient.gitGetCurrentBranch(repoPath),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
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

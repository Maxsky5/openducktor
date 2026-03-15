import type {
  GitBranch,
  GitCurrentBranch,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";

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

export const repoBranchesQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: gitQueryKeys.branches(repoPath),
    queryFn: (): Promise<GitBranch[]> => host.gitGetBranches(repoPath),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
  });

const currentBranchQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: gitQueryKeys.currentBranch(repoPath),
    queryFn: (): Promise<GitCurrentBranch> => host.gitGetCurrentBranch(repoPath),
    staleTime: BRANCH_DATA_STALE_TIME_MS,
  });

const worktreeStatusQueryOptions = (
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
) =>
  queryOptions({
    queryKey: gitQueryKeys.worktreeStatus(repoPath, targetBranch, diffScope, workingDir),
    queryFn: (): Promise<GitWorktreeStatus> =>
      host.gitGetWorktreeStatus(repoPath, targetBranch, diffScope, workingDir ?? undefined),
    staleTime: WORKTREE_STATUS_STALE_TIME_MS,
  });

const worktreeStatusSummaryQueryOptions = (
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
) =>
  queryOptions({
    queryKey: gitQueryKeys.worktreeStatusSummary(repoPath, targetBranch, diffScope, workingDir),
    queryFn: (): Promise<GitWorktreeStatusSummary> =>
      host.gitGetWorktreeStatusSummary(repoPath, targetBranch, diffScope, workingDir ?? undefined),
    staleTime: WORKTREE_STATUS_STALE_TIME_MS,
  });

export const loadRepoBranchesFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<GitBranch[]> => queryClient.fetchQuery(repoBranchesQueryOptions(repoPath));

export const loadCurrentBranchFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<GitCurrentBranch> => queryClient.fetchQuery(currentBranchQueryOptions(repoPath));

export const loadWorktreeStatusFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  targetBranch: string,
  diffScope: "target" | "uncommitted",
  workingDir: string | null,
  options?: {
    force?: boolean;
  },
): Promise<GitWorktreeStatus> => {
  const queryKey = gitQueryKeys.worktreeStatus(repoPath, targetBranch, diffScope, workingDir);

  if (options?.force === true) {
    void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  }

  return queryClient.fetchQuery({
    ...worktreeStatusQueryOptions(repoPath, targetBranch, diffScope, workingDir),
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
    ...worktreeStatusSummaryQueryOptions(repoPath, targetBranch, diffScope, workingDir),
    staleTime: options?.force === true ? 0 : WORKTREE_STATUS_STALE_TIME_MS,
  });
};

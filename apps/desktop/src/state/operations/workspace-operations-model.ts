import type { GitCurrentBranch } from "@openducktor/contracts";

type ProbeBranchChangeParams = {
  activeRepo: string | null;
  isSwitchingWorkspace: boolean;
  isSwitchingBranch: boolean;
  isLoadingBranches: boolean;
  isSyncInFlight: boolean;
};

export const BRANCH_SYNC_INTERVAL_MS = 30000;

export const normalizeRepoPath = (repoPath: string): string => repoPath.trim();

export const shouldProbeExternalBranchChange = ({
  activeRepo,
  isSwitchingWorkspace,
  isSwitchingBranch,
  isLoadingBranches,
  isSyncInFlight,
}: ProbeBranchChangeParams): boolean => {
  return Boolean(
    activeRepo &&
      !isSwitchingWorkspace &&
      !isSwitchingBranch &&
      !isLoadingBranches &&
      !isSyncInFlight,
  );
};

export const hasBranchIdentityChanged = (
  current: GitCurrentBranch,
  lastKnownName: string | null,
  lastKnownDetached: boolean | null,
): boolean => (current.name ?? null) !== lastKnownName || current.detached !== lastKnownDetached;

export const shouldSkipBranchSwitch = (
  activeBranch: GitCurrentBranch | null,
  branchName: string,
): boolean => activeBranch?.name === branchName && !activeBranch.detached;

export const swallowBranchProbeError = (_error: unknown): void => {};

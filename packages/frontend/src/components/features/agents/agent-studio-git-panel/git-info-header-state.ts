import type { GitInfoHeaderProps } from "./git-info-header";

const getRebaseTooltip = ({
  hasUncommittedFiles,
  isGitActionsLocked,
  isRebasing,
  gitActionsLockReason,
  rebaseBehindCount,
}: {
  hasUncommittedFiles: boolean;
  isGitActionsLocked: boolean;
  isRebasing: boolean;
  gitActionsLockReason: string | null | undefined;
  rebaseBehindCount: number | null;
}): string => {
  if (isRebasing) {
    return "Rebasing";
  }
  if (isGitActionsLocked) {
    return gitActionsLockReason ?? "Git actions are disabled.";
  }
  if (hasUncommittedFiles) {
    return "Commit or stash changes before rebasing";
  }
  if (rebaseBehindCount != null && rebaseBehindCount > 0) {
    return `Rebase onto target (${rebaseBehindCount} behind)`;
  }
  return "Rebase onto target";
};

const getPullTooltip = ({
  gitActionsLockReason,
  hasUncommittedFiles,
  isGitActionsLocked,
  isRebasing,
  isRepositoryMode,
  pushAheadCount,
  pushBehindCount,
  upstreamStatus,
}: {
  gitActionsLockReason: string | null | undefined;
  hasUncommittedFiles: boolean;
  isGitActionsLocked: boolean;
  isRebasing: boolean;
  isRepositoryMode: boolean;
  pushAheadCount: number | null;
  pushBehindCount: number | null;
  upstreamStatus: GitInfoHeaderProps["upstreamStatus"];
}): string => {
  if (isRebasing) {
    return "Pulling";
  }
  if (isGitActionsLocked) {
    return gitActionsLockReason ?? "Git actions are disabled.";
  }
  if (isRepositoryMode && upstreamStatus === "untracked") {
    return "No upstream branch yet. Push this branch first to create it.";
  }
  if (hasUncommittedFiles) {
    return "Commit or stash changes before pulling";
  }
  if (
    pushAheadCount != null &&
    pushAheadCount > 0 &&
    pushBehindCount != null &&
    pushBehindCount > 0
  ) {
    const commitSuffix = pushAheadCount === 1 ? "" : "s";
    return `Pull with rebase (${pushBehindCount} behind; ${pushAheadCount} local commit${commitSuffix} will be rewritten)`;
  }
  if (pushBehindCount != null && pushBehindCount > 0) {
    return `Pull (${pushBehindCount} behind)`;
  }
  return "Pull";
};

const getPushTooltip = ({
  canPublishUntrackedBranch,
  gitActionsLockReason,
  hasUpstreamAhead,
  hasUpstreamBehind,
  isGitActionsLocked,
  isPushing,
  pushAheadCount,
  pushBehindCount,
}: {
  canPublishUntrackedBranch: boolean;
  gitActionsLockReason: string | null | undefined;
  hasUpstreamAhead: boolean;
  hasUpstreamBehind: boolean;
  isGitActionsLocked: boolean;
  isPushing: boolean;
  pushAheadCount: number | null;
  pushBehindCount: number | null;
}): string => {
  if (isPushing) {
    return "Pushing";
  }
  if (isGitActionsLocked) {
    return gitActionsLockReason ?? "Git actions are disabled.";
  }
  if (canPublishUntrackedBranch) {
    // A branch without a remote branch still pushes; its first push creates the remote branch.
    return hasUpstreamAhead ? `Push branch (${pushAheadCount} ahead)` : "Push branch";
  }
  if (hasUpstreamBehind) {
    return `Push branch (${pushBehindCount} behind; confirmation may be required)`;
  }
  if (hasUpstreamAhead) {
    return `Push branch (${pushAheadCount} ahead)`;
  }
  return "Branch is up to date with upstream";
};

export type GitInfoHeaderStateInput = {
  branchKnown: boolean;
  branch: GitInfoHeaderProps["branch"];
  commitsAheadBehind: GitInfoHeaderProps["commitsAheadBehind"];
  contextMode: GitInfoHeaderProps["contextMode"];
  gitActionsLockReason: GitInfoHeaderProps["gitActionsLockReason"];
  isCommitting: boolean | undefined;
  isGitActionsLocked: boolean | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  isPushing: boolean | undefined;
  isRebasing: boolean | undefined;
  isChanging: boolean | undefined;
  onDetectPullRequest: GitInfoHeaderProps["onDetectPullRequest"];
  onUpdateTargetBranch: GitInfoHeaderProps["onUpdateTargetBranch"];
  pullFromUpstream: GitInfoHeaderProps["pullFromUpstream"];
  pullRequest: GitInfoHeaderProps["pullRequest"] | undefined;
  pushBranch: GitInfoHeaderProps["pushBranch"];
  rebaseOntoTarget: GitInfoHeaderProps["rebaseOntoTarget"];
  targetBranch: string;
  targetBranchOptions: NonNullable<GitInfoHeaderProps["targetBranchOptions"]>;
  uncommittedFileCount: number;
  upstreamAheadBehind: GitInfoHeaderProps["upstreamAheadBehind"];
  upstreamStatus: GitInfoHeaderProps["upstreamStatus"];
};

export const getGitInfoHeaderState = (props: GitInfoHeaderStateInput) => {
  const isRepositoryMode = props.contextMode === "repository";
  const trimmedTargetBranch = props.targetBranch.trim();
  const isDetachedHead = props.branch == null || props.branch.trim().length === 0;
  const hasTargetBranch = trimmedTargetBranch.length > 0;
  const targetAheadCount = props.commitsAheadBehind?.ahead ?? null;
  const rebaseBehindCount = props.commitsAheadBehind?.behind ?? null;
  const pushAheadCount = props.upstreamAheadBehind?.ahead ?? null;
  const pushBehindCount = props.upstreamAheadBehind?.behind ?? null;
  const hasTargetAhead = targetAheadCount != null && targetAheadCount > 0;
  const hasUncommittedFiles = props.uncommittedFileCount > 0;
  const hasUpstreamAhead = pushAheadCount != null && pushAheadCount > 0;
  const hasUpstreamBehind = pushBehindCount != null && pushBehindCount > 0;
  const canPublishUntrackedBranch = props.upstreamStatus === "untracked";
  const hasPushAction = canPublishUntrackedBranch || hasUpstreamAhead || hasUpstreamBehind;
  const isCommitting = Boolean(props.isCommitting);
  const isGitActionsLocked = Boolean(props.isGitActionsLocked);
  const isPushing = Boolean(props.isPushing);
  const isRebasing = Boolean(props.isRebasing);
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing || Boolean(props.isChanging);
  const canRefresh = !props.isRefreshing && !isAnyActionInFlight;
  const canRebase =
    !isRepositoryMode &&
    !isDetachedHead &&
    hasTargetBranch &&
    !hasUncommittedFiles &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    props.rebaseOntoTarget != null;
  const canPull =
    !isDetachedHead &&
    hasUpstreamBehind &&
    !hasUncommittedFiles &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    props.pullFromUpstream != null;
  const canPush =
    !isDetachedHead &&
    hasPushAction &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    props.pushBranch != null;
  const tooltipState = {
    gitActionsLockReason: props.gitActionsLockReason,
    hasUncommittedFiles,
    isGitActionsLocked,
    isRebasing,
  };

  return {
    canEditTargetBranch: !isRepositoryMode && props.onUpdateTargetBranch != null,
    canPull,
    canPush,
    canRebase,
    canRefresh,
    currentBranchLabel: getBranchLabel(props),
    hasTargetAhead,
    isRepositoryMode,
    pullTooltip: getPullTooltip({
      ...tooltipState,
      isRepositoryMode,
      pushAheadCount,
      pushBehindCount,
      upstreamStatus: props.upstreamStatus,
    }),
    pushAheadCount,
    pushBehindCount,
    pushTooltip: getPushTooltip({
      canPublishUntrackedBranch,
      gitActionsLockReason: props.gitActionsLockReason,
      hasUpstreamAhead,
      hasUpstreamBehind,
      isGitActionsLocked,
      isPushing,
      pushAheadCount,
      pushBehindCount,
    }),
    rebaseBehindCount,
    rebaseTooltip: getRebaseTooltip({ ...tooltipState, rebaseBehindCount }),
    showDetectPullRequest: props.pullRequest == null && props.onDetectPullRequest != null,
    targetAheadCount,
    targetBranchLabel: hasTargetBranch ? props.targetBranch : "No comparison target",
  };
};

function getBranchLabel(props: GitInfoHeaderStateInput): string {
  if (!props.branchKnown) return props.isLoading ? "Reading branch..." : "Branch unavailable";
  return props.branch?.trim() ? props.branch : "Detached HEAD";
}

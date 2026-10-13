import type { ComponentProps, ReactElement } from "react";
import type { GitPanelTabBadges } from "./constants";
import type { GitInfoHeader } from "./git-info-header";
import type { AgentStudioGitPanelModel, GitPanelView } from "./types";

export function getGitInfoHeaderProps(
  model: AgentStudioGitPanelModel,
  view: GitPanelView,
): ComponentProps<typeof GitInfoHeader> {
  const local = model.scopeStatesByScope.uncommitted;
  const props: ComponentProps<typeof GitInfoHeader> = {
    contextMode: model.contextMode ?? "worktree",
    comparisonUnavailableReason: model.comparisonUnavailableReason ?? null,
    comparisonPending: model.comparisonPending ?? false,
    branchKnown: model.branchKnown ?? true,
    comparisonReference: model.comparisonReference ?? null,
    pullRequest: model.pullRequest ?? null,
    branch: model.branch,
    targetBranch: model.targetBranch,
    activeTab: view.activeTab,
    onTabChange: view.onTabChange,
    tabBadges: tabBadges(model),
    uncommittedFileCount: local.uncommittedFileCount,
    commitsAheadBehind: model.commitsAheadBehind,
    upstreamAheadBehind: local.upstreamAheadBehind ?? null,
    upstreamStatus: local.upstreamStatus,
    upstreamError: local.upstreamError ?? null,
    isLoading: model.isLoading,
    isRefreshing: model.isRefreshing ?? false,
    refreshError: model.refreshError ?? null,
    isCommitting: model.isCommitting ?? false,
    isPushing: model.isPushing ?? false,
    isRebasing: model.isRebasing ?? false,
    isChanging: model.isChanging ?? false,
    isDetectingPullRequest: model.isDetectingPullRequest ?? false,
    detectPullRequestDisabledReason: model.detectPullRequestDisabledReason ?? null,
    isGitActionsLocked: model.isGitActionsLocked ?? false,
    gitActionsLockReason: model.gitActionsLockReason ?? null,
    showLockReasonBanner: !view.conflict.hasConflict && (model.showLockReasonBanner ?? true),
    pushError: model.pushError ?? null,
    rebaseError: model.rebaseError ?? null,
    pushBranch: model.pushBranch ?? null,
    rebaseOntoTarget: model.rebaseOntoTarget ?? null,
    pullFromUpstream: model.pullFromUpstream ?? null,
    onDetectPullRequest: model.onDetectPullRequest ?? null,
    targetBranchEditable: model.targetBranchEditable,
    targetBranchHelpText: model.targetBranchHelpText,
    targetBranchesPending: model.targetBranchesPending,
    targetBranchesError: model.targetBranchesError,
    retryTargetBranches: model.retryTargetBranches,
    targetBranchOptions: model.targetBranchOptions ?? [],
    targetBranchSelectionValue: model.targetBranchSelectionValue ?? "",
    // The panel shows refresh failures. Keep a read failure out of the app error boundary.
    onRefresh: () => void model.refresh().catch(() => {}),
  };
  if (model.onUpdateTargetBranch) {
    props.onUpdateTargetBranch = model.onUpdateTargetBranch;
  }
  if (model.repositoryBranchControl) {
    props.repositoryBranchControl = model.repositoryBranchControl;
  }
  return props;
}

function CountBadge({ value, label }: { value: number; label: string }): ReactElement {
  return (
    <span
      className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
      aria-label={label}
    >
      {value}
    </span>
  );
}

function tabBadges(model: AgentStudioGitPanelModel): GitPanelTabBadges {
  const badges: GitPanelTabBadges = {};
  const local = model.scopeStatesByScope.uncommitted;
  if (model.loadedScopesByScope.uncommitted && local.uncommittedFileCount > 0) {
    badges.uncommitted = (
      <CountBadge
        value={local.uncommittedFileCount}
        label={`${local.uncommittedFileCount} files`}
      />
    );
  }
  const target = model.scopeStatesByScope.target;
  if (
    model.comparisonReference &&
    model.loadedScopesByScope.target &&
    target.fileDiffs.length > 0
  ) {
    badges.target = (
      <CountBadge value={target.fileDiffs.length} label={`${target.fileDiffs.length} files`} />
    );
  }
  return badges;
}

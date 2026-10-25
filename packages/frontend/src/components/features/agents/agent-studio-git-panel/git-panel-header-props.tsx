import type { ComboboxOption } from "@/components/ui/combobox";
import type { ComponentProps } from "react";
import { gitPanelTabCounts } from "@openducktor/frontend-core/git/model/git-panel-header";
import type { GitInfoHeader } from "./git-info-header";
import type { AgentStudioGitPanelModel, GitPanelView } from "./types";

const NO_TARGET_OPTIONS: ComboboxOption[] = [];

export function getGitInfoHeaderProps(
  model: AgentStudioGitPanelModel,
  view: GitPanelView,
  onRefresh: () => void,
): ComponentProps<typeof GitInfoHeader> {
  const local = model.scopeStatesByScope.uncommitted;
  const counts = gitPanelTabCounts(model);
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
    uncommittedTabCount: counts.uncommitted,
    targetTabCount: counts.target,
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
    targetBranchOptions: model.targetBranchOptions ?? NO_TARGET_OPTIONS,
    targetBranchSelectionValue: model.targetBranchSelectionValue ?? "",
    onRefresh,
  };
  if (model.onUpdateTargetBranch) {
    props.onUpdateTargetBranch = model.onUpdateTargetBranch;
  }
  if (model.repositoryBranchControl) {
    props.repositoryBranchControl = model.repositoryBranchControl;
  }
  return props;
}

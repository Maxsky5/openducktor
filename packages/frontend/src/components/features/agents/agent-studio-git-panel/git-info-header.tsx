import { ArrowDown, ArrowRight, ArrowUp, GitBranch } from "lucide-react";
import { memo, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BRANCH_CHIP_CLASS_NAME } from "@/components/features/repository/branch-chip-classnames";
import type { GitPanelTab } from "./constants";
import { GitActionRow } from "./git-header-actions";
import { headerNotices } from "./git-header-notice-items";
import { HeaderNotice } from "./git-header-notices";
import { getGitInfoHeaderState } from "./git-info-header-state";
import { GitPanelTabs } from "./git-panel-tabs";
import { GitTargetBranchChip, GitTargetBranchSelector } from "./git-target-branch-control";
import type { AgentStudioGitPanelModel } from "./types";

export type GitInfoHeaderProps = Pick<
  AgentStudioGitPanelModel,
  | "targetBranchEditable"
  | "targetBranchHelpText"
  | "targetBranchesPending"
  | "targetBranchesError"
  | "retryTargetBranches"
  | "contextMode"
  | "comparisonPending"
  | "branchKnown"
  | "comparisonUnavailableReason"
  | "comparisonReference"
  | "pullRequest"
  | "branch"
  | "targetBranch"
  | "commitsAheadBehind"
  | "upstreamAheadBehind"
  | "upstreamStatus"
  | "upstreamError"
  | "isLoading"
  | "isCommitting"
  | "isPushing"
  | "isRebasing"
  | "isChanging"
  | "isDetectingPullRequest"
  | "detectPullRequestDisabledReason"
  | "isGitActionsLocked"
  | "gitActionsLockReason"
  | "showLockReasonBanner"
  | "pushError"
  | "rebaseError"
  | "targetBranchOptions"
  | "targetBranchSelectionValue"
  | "onUpdateTargetBranch"
> & {
  activeTab: GitPanelTab;
  onTabChange: (tab: GitPanelTab) => void;
  /** The file count of the Uncommitted changes tab, or null for none. */
  uncommittedTabCount: number | null;
  /** The file count of the Branch changes tab, or null for none. */
  targetTabCount: number | null;
  isRefreshing: boolean;
  refreshError: string | null;
  uncommittedFileCount: number;
  pushBranch: (() => Promise<void>) | null;
  rebaseOntoTarget: (() => Promise<void>) | null;
  pullFromUpstream: (() => Promise<void>) | null;
  onDetectPullRequest?: (() => Promise<void> | void) | null;
  onRefresh: () => void;
  /** Replaces the read-only branch label in repository mode with a branch switcher. */
  repositoryBranchControl?: ReactNode;
  diffPanelId?: string;
};

export const GitInfoHeader = memo(function GitInfoHeader(props: GitInfoHeaderProps): ReactElement {
  const view = getGitInfoHeaderView(props);
  const { state } = view;

  return (
    <div className="@container/git-header flex shrink-0 flex-col">
      {/* The checkout, the branch it compares with, and the commit counts against that branch. */}
      <div
        className="flex h-10 min-w-0 items-center gap-1 px-2"
        data-testid="agent-studio-git-branch-context-row"
      >
        <CurrentBranch
          label={state.currentBranchLabel}
          repositoryBranchControl={view.repositoryBranchControl}
        />
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        {/* The target is often short, so it keeps its name, and the current branch shortens. */}
        <div className="flex min-w-0 max-w-[45%] shrink-0 items-center">
          {view.canEditTargetBranch ? (
            <GitTargetBranchSelector
              branch={state.currentBranchLabel}
              control={{
                targetBranchHelpText: props.targetBranchHelpText,
                targetBranchesPending: props.targetBranchesPending,
                targetBranchesError: props.targetBranchesError,
                retryTargetBranches: props.retryTargetBranches,
              }}
              targetBranchLabel={state.targetBranchLabel}
              targetBranchOptions={view.targetBranchOptions}
              targetBranchSelectionValue={view.targetBranchSelectionValue}
              onUpdateTargetBranch={props.onUpdateTargetBranch}
            />
          ) : (
            <GitTargetBranchChip label={state.targetBranchLabel} />
          )}
        </div>
        {view.comparison && (view.comparison.ahead > 0 || view.comparison.behind > 0) ? (
          <ComparisonCounts comparison={view.comparison} targetLabel={state.targetBranchLabel} />
        ) : null}
      </div>
      <GitActionRow
        actionState={view.actionState}
        onDetectPullRequest={props.onDetectPullRequest}
        onRefresh={props.onRefresh}
        pullFromUpstream={props.pullFromUpstream}
        pullTooltip={state.pullTooltip}
        pushAheadCount={state.pushAheadCount}
        pushBehindCount={state.pushBehindCount}
        pushBranch={props.pushBranch}
        pushTooltip={state.pushTooltip}
        rebaseBehindCount={state.rebaseBehindCount}
        rebaseOntoTarget={props.rebaseOntoTarget}
        rebaseTooltip={view.rebaseTooltip}
      />
      {view.notices.map(({ key, ...notice }) => (
        <HeaderNotice key={key} {...notice} />
      ))}
      <GitPanelTabs
        activeTab={props.activeTab}
        onTabChange={props.onTabChange}
        uncommittedCount={props.uncommittedTabCount}
        targetCount={props.targetTabCount}
        panelId={props.diffPanelId}
      />
    </div>
  );
});

/** Everything the header shows, derived from its props outside the render function. */
function getGitInfoHeaderView(props: GitInfoHeaderProps) {
  const targetBranchOptions = props.targetBranchOptions ?? [];
  const state = getGitInfoHeaderState({
    branchKnown: props.branchKnown ?? true,
    contextMode: props.contextMode ?? "worktree",
    pullRequest: props.pullRequest,
    branch: props.branch,
    targetBranch: props.targetBranch,
    commitsAheadBehind: props.commitsAheadBehind,
    upstreamAheadBehind: props.upstreamAheadBehind,
    upstreamStatus: props.upstreamStatus,
    uncommittedFileCount: props.uncommittedFileCount,
    isLoading: props.isLoading,
    isRefreshing: props.isRefreshing,
    isCommitting: props.isCommitting,
    isPushing: props.isPushing,
    isRebasing: props.isRebasing,
    isChanging: props.isChanging,
    isGitActionsLocked: props.isGitActionsLocked,
    gitActionsLockReason: props.gitActionsLockReason,
    pushBranch: props.pushBranch,
    rebaseOntoTarget: props.rebaseOntoTarget,
    pullFromUpstream: props.pullFromUpstream,
    onDetectPullRequest: props.onDetectPullRequest,
    targetBranchOptions,
    onUpdateTargetBranch: props.onUpdateTargetBranch,
  });
  const comparisonShown = !props.comparisonUnavailableReason && !props.comparisonPending;
  const detectPullRequestDisabledReason = props.detectPullRequestDisabledReason ?? null;
  return {
    state,
    targetBranchOptions,
    targetBranchSelectionValue: props.targetBranchSelectionValue ?? "",
    canEditTargetBranch: props.targetBranchEditable ?? state.canEditTargetBranch,
    repositoryBranchControl: state.isRepositoryMode
      ? (props.repositoryBranchControl ?? null)
      : null,
    comparison: comparisonShown ? (props.commitsAheadBehind ?? null) : null,
    rebaseTooltip: `${state.rebaseTooltip}: ${props.comparisonReference ?? props.targetBranch}`,
    actionState: {
      canPull: state.canPull,
      canPush: state.canPush,
      canRebase: state.canRebase,
      canRefresh: state.canRefresh,
      isDetectingPullRequest: Boolean(props.isDetectingPullRequest),
      isRefreshing: props.isRefreshing || props.isLoading,
      isPushing: Boolean(props.isPushing),
      isRepositoryMode: state.isRepositoryMode,
      showDetectPullRequest: state.showDetectPullRequest,
      detectPullRequestDisabledReason,
    },
    notices: headerNotices({
      detectPullRequestError: state.showDetectPullRequest ? detectPullRequestDisabledReason : null,
      lockReason:
        props.showLockReasonBanner && props.isGitActionsLocked
          ? (props.gitActionsLockReason ?? null)
          : null,
      refreshError: props.refreshError,
      upstreamError: props.upstreamStatus === "error" ? (props.upstreamError ?? "") : null,
      comparisonUnavailableReason: props.comparisonPending
        ? null
        : (props.comparisonUnavailableReason ?? null),
      rebaseError: props.rebaseError ?? null,
      pushError: props.pushError ?? null,
    }),
  };
}

/** The checkout. Repository sessions get a branch switcher. */
function CurrentBranch({
  label,
  repositoryBranchControl,
}: {
  label: string;
  repositoryBranchControl: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 shrink items-center">
      {repositoryBranchControl ?? (
        <span
          className={cn(BRANCH_CHIP_CLASS_NAME, "cursor-default")}
          title={`Current branch: ${label}`}
          data-testid="agent-studio-git-current-branch-display-row"
        >
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Current branch:</span>
          <span className="min-w-0 truncate" data-testid="agent-studio-git-current-branch">
            {label}
          </span>
        </span>
      )}
    </div>
  );
}

function ComparisonCounts({
  comparison,
  targetLabel,
}: {
  comparison: { ahead: number; behind: number };
  targetLabel: string;
}): ReactElement {
  const label = `${comparison.ahead} commit${comparison.ahead === 1 ? "" : "s"} ahead of ${targetLabel}, ${comparison.behind} behind`;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums"
      title={label}
      aria-label={label}
      role="img"
      data-testid="agent-studio-git-comparison-counts"
    >
      <span
        className="inline-flex items-center text-emerald-600 dark:text-emerald-400"
        data-testid="agent-studio-git-target-ahead-count"
      >
        <ArrowUp className="size-3" aria-hidden="true" />
        {comparison.ahead}
      </span>
      <span
        className="inline-flex items-center text-rose-600 dark:text-rose-400"
        data-testid="agent-studio-git-target-behind-count"
      >
        <ArrowDown className="size-3" aria-hidden="true" />
        {comparison.behind}
      </span>
    </span>
  );
}

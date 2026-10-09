import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  Link2,
  LoaderCircle,
  RefreshCw,
  Target,
} from "lucide-react";
import { memo, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  segmentedControlRootClassName,
  segmentedControlTriggerClassName,
} from "@/components/ui/segmented-control-classnames";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import { cn } from "@/lib/utils";
import { DIFF_SCOPE_OPTIONS } from "./constants";
import { GitTargetBranchControl } from "./git-target-branch-control";
import type { AgentStudioGitPanelModel } from "./types";

type GitInfoHeaderProps = Pick<
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
  | "diffScope"
  | "isLoading"
  | "isCommitting"
  | "isPushing"
  | "isRebasing"
  | "isResetting"
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
  | "setDiffScope"
> & {
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
  const state = getGitInfoHeaderState({
    ...props,
    branchKnown: props.branchKnown ?? true,
    targetBranchOptions: props.targetBranchOptions ?? [],
  });
  const { comparisonUnavailableReason } = props;

  return (
    <div className="@container/git-header flex flex-col border-b border-border bg-card">
      <GitBranchRows props={props} state={state} />
      <GitRemoteActions props={props} state={state} />
      <GitNotices props={props} showDetectPullRequest={state.showDetectPullRequest} />
      <GitDiffScopeTabs
        diffScope={props.diffScope}
        onScopeChange={(scope) => {
          if (scope !== props.diffScope) props.setDiffScope(scope);
        }}
        comparisonUnavailableReason={comparisonUnavailableReason ?? null}
        fileCount={props.uncommittedFileCount}
        panelId={props.diffPanelId}
      />
    </div>
  );
});

type HeaderState = ReturnType<typeof getGitInfoHeaderState>;

function GitBranchRows({
  props,
  state,
}: {
  props: GitInfoHeaderProps;
  state: HeaderState;
}): ReactElement {
  const { comparisonUnavailableReason, comparisonPending, targetBranch, isLoading } = props;
  return (
    <div className="space-y-1 px-3 pt-2.5 pb-1.5">
      <div
        className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1"
        data-testid="agent-studio-git-branch-context-row"
      >
        <span className="text-xs text-muted-foreground">Branch</span>
        {state.isRepositoryMode && props.repositoryBranchControl ? (
          <div className="min-w-0">{props.repositoryBranchControl}</div>
        ) : (
          <div
            className="flex h-7 min-w-0 items-center gap-2"
            data-testid="agent-studio-git-current-branch-display-row"
          >
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="min-w-0 truncate font-mono text-xs"
              title={`Current branch: ${state.currentBranchLabel}`}
              data-testid="agent-studio-git-current-branch"
            >
              {state.currentBranchLabel}
            </span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">Compare</span>
        <GitTargetBranchControl
          key={String(props.targetBranchEditable ?? state.canEditTargetBranch)}
          branch={state.currentBranchLabel}
          control={{
            targetBranchHelpText: props.targetBranchHelpText,
            targetBranchesPending: props.targetBranchesPending,
            targetBranchesError: props.targetBranchesError,
            retryTargetBranches: props.retryTargetBranches,
          }}
          canEditTargetBranch={props.targetBranchEditable ?? state.canEditTargetBranch}
          targetBranchLabel={state.targetBranchLabel}
          targetBranchOptions={props.targetBranchOptions ?? []}
          targetBranchSelectionValue={props.targetBranchSelectionValue ?? ""}
          onUpdateTargetBranch={props.onUpdateTargetBranch}
        />
      </div>
      <div className="grid min-h-7 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
        <span className="text-xs text-muted-foreground">Commits</span>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <ComparisonCounts
            counts={props.commitsAheadBehind}
            pending={Boolean(comparisonPending || isLoading)}
            unavailable={Boolean(comparisonUnavailableReason)}
            target={targetBranch}
          />
          {!state.isRepositoryMode ? (
            <GitActionButton
              testId="agent-studio-git-rebase-button"
              srLabel="Rebase onto target"
              label="Rebase"
              icon={Target}
              onClick={props.rebaseOntoTarget ? () => void props.rebaseOntoTarget?.() : null}
              disabled={!state.canRebase}
              tooltip={`${state.rebaseTooltip}: ${props.comparisonReference ?? targetBranch}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GitRemoteActions({
  props,
  state,
}: {
  props: GitInfoHeaderProps;
  state: HeaderState;
}): ReactElement {
  const { isLoading } = props;
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-1.5"
      data-testid="agent-studio-git-action-row"
    >
      <GitActionButton
        testId="agent-studio-git-pull-button"
        srLabel="Pull from upstream"
        label="Pull"
        icon={ArrowDown}
        onClick={props.pullFromUpstream ? () => void props.pullFromUpstream?.() : null}
        disabled={!state.canPull}
        tooltip={state.pullTooltip}
        count={state.pushBehindCount}
        countTestId="agent-studio-git-upstream-behind-count"
      />
      <GitActionButton
        testId="agent-studio-git-push-button"
        srLabel="Push branch"
        label={props.upstreamStatus === "untracked" ? "Publish" : "Push"}
        icon={props.isPushing ? LoaderCircle : ArrowUp}
        onClick={props.pushBranch ? () => void props.pushBranch?.() : null}
        disabled={!state.canPush}
        tooltip={state.pushTooltip}
        spinning={Boolean(props.isPushing)}
        count={state.pushAheadCount}
        countTestId="agent-studio-git-ahead-count"
      />
      <span className="flex-1" />
      {state.showDetectPullRequest ? (
        <GitActionButton
          testId="agent-studio-git-detect-pr-button"
          srLabel="Detect PR"
          label="Find PR"
          icon={Link2}
          onClick={() => void props.onDetectPullRequest?.()}
          disabled={Boolean(props.isDetectingPullRequest || props.detectPullRequestDisabledReason)}
          tooltip={props.detectPullRequestDisabledReason ?? "Find this branch's pull request"}
          spinning={Boolean(props.isDetectingPullRequest)}
        />
      ) : null}
      <GitActionButton
        testId="agent-studio-git-refresh-button"
        srLabel="Refresh"
        label="Refresh"
        icon={RefreshCw}
        onClick={props.onRefresh}
        disabled={!state.canRefresh}
        tooltip={isLoading ? "Refreshing" : "Fetch branches and refresh changes"}
        spinning={isLoading}
      />
    </div>
  );
}

function GitNotices({
  props,
  showDetectPullRequest,
}: {
  props: GitInfoHeaderProps;
  showDetectPullRequest: boolean;
}): ReactElement {
  const { comparisonUnavailableReason, comparisonPending } = props;
  return (
    <>
      {props.upstreamStatus === "untracked" ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          No remote branch yet. Publish to share it.
        </p>
      ) : null}
      {props.showLockReasonBanner && props.isGitActionsLocked && props.gitActionsLockReason ? (
        <p
          className="bg-warning-surface px-3 py-2 text-xs text-warning-surface-foreground"
          data-testid="agent-studio-git-lock-reason"
        >
          {props.gitActionsLockReason}
        </p>
      ) : null}
      {props.upstreamStatus === "error" ? (
        <GitError
          title="Cannot read remote branch status"
          message={props.upstreamError ?? "Upstream status is unavailable."}
          help="Refresh to fetch the remote. If this continues, check branch tracking settings."
        />
      ) : null}
      {comparisonUnavailableReason && !comparisonPending ? (
        <GitError
          title="Comparison unavailable"
          message={comparisonUnavailableReason}
          help="Choose another comparison branch or refresh to fetch it."
        />
      ) : null}
      {props.detectPullRequestDisabledReason && showDetectPullRequest ? (
        <GitError
          title="Cannot find pull request"
          message={props.detectPullRequestDisabledReason}
        />
      ) : null}
      {props.rebaseError ? (
        <GitError
          title="Git update failed"
          message={props.rebaseError}
          testId="agent-studio-git-rebase-error"
        />
      ) : null}
      {props.pushError ? (
        <GitError
          title="Push failed"
          message={props.pushError}
          testId="agent-studio-git-push-error"
        />
      ) : null}
    </>
  );
}

function ComparisonCounts({
  counts,
  pending,
  unavailable,
  target,
}: {
  counts: GitInfoHeaderProps["commitsAheadBehind"];
  pending: boolean;
  unavailable: boolean;
  target: string;
}): ReactElement {
  if (unavailable)
    return (
      <span className="text-[11px] text-muted-foreground">
        {pending ? "Checking comparison..." : "Comparison unavailable"}
      </span>
    );
  if (!counts)
    return (
      <span className="text-[11px] text-muted-foreground">
        {pending ? "Checking comparison..." : "Commit counts unavailable"}
      </span>
    );
  return (
    <span
      className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground"
      title={`Commits compared with ${target}`}
      aria-label={`Commits compared with ${target}`}
      role="group"
    >
      <span data-testid="agent-studio-git-target-ahead-count">{counts.ahead} ahead</span>
      <span aria-hidden="true">/</span>
      <span data-testid="agent-studio-git-behind-count">{counts.behind} behind</span>
    </span>
  );
}

function GitActionButton({
  testId,
  srLabel,
  label,
  icon: Icon,
  onClick,
  disabled,
  tooltip,
  count,
  countTestId,
  spinning = false,
}: {
  testId: string;
  srLabel: string;
  label: string;
  icon: typeof RefreshCw;
  onClick: (() => void) | null;
  disabled: boolean;
  tooltip: string;
  count?: number | null;
  countTestId?: string;
  spinning?: boolean;
}): ReactElement {
  const descriptionId = `${testId}-tooltip-description`;
  return (
    <>
      <span id={descriptionId} className="sr-only">
        {tooltip}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex"
            data-testid={
              testId === "agent-studio-git-pull-button"
                ? "agent-studio-git-pull-tooltip-trigger"
                : undefined
            }
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
              onClick={onClick ?? undefined}
              disabled={disabled}
              data-testid={testId}
              aria-label={srLabel}
              aria-describedby={descriptionId}
            >
              <Icon className={cn("size-3.5 shrink-0", spinning && "motion-safe:animate-spin")} />
              {label}
              {count != null && count > 0 ? (
                <span
                  className="rounded bg-muted px-1 text-[10px] font-medium tabular-nums text-foreground"
                  data-testid={countTestId}
                >
                  {count}
                </span>
              ) : null}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function GitError({
  title,
  message,
  help,
  testId,
}: {
  title: string;
  message: string;
  help?: string;
  testId?: string;
}): ReactElement {
  return (
    <div
      role="alert"
      className="space-y-1 border-t border-border bg-destructive-surface px-3 py-2 text-xs"
      data-testid={testId}
    >
      <p className="font-medium text-destructive-surface-foreground">{title}</p>
      {help ? <p className="text-muted-foreground">{help}</p> : null}
      {message.includes("\n") ? (
        <details className="text-muted-foreground">
          <summary className="w-fit cursor-pointer text-[11px] hover:text-foreground">
            Details
          </summary>
          <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">{message}</p>
        </details>
      ) : (
        <p className="break-words text-muted-foreground">{message}</p>
      )}
    </div>
  );
}

function GitDiffScopeTabs({
  diffScope,
  onScopeChange,
  comparisonUnavailableReason,
  fileCount,
  panelId,
}: {
  diffScope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
  comparisonUnavailableReason: string | null;
  fileCount: number;
  panelId?: string | undefined;
}): ReactElement {
  return (
    <Tabs
      value={diffScope}
      onValueChange={(value) => {
        if (value === "target" || value === "uncommitted") onScopeChange(value);
      }}
      className="gap-0 px-3 pb-2"
    >
      <TabsList
        aria-label="Git diff scope"
        className={segmentedControlRootClassName({ size: "sm", className: "w-full" })}
      >
        {DIFF_SCOPE_OPTIONS.map((option) => (
          <TabsTrigger
            key={option.scope}
            value={option.scope}
            id={panelId ? `${panelId}-tab-${option.scope}` : undefined}
            aria-controls={panelId}
            disabled={option.scope === "target" && Boolean(comparisonUnavailableReason)}
            title={
              option.scope === "target"
                ? (comparisonUnavailableReason ?? "Changes since the comparison branch")
                : "Changes not yet committed"
            }
            className={cn(
              segmentedControlTriggerClassName({
                size: "sm",
                inactiveClassName: "hover:bg-background/80",
              }),
              "gap-1.5 border-none bg-transparent text-foreground transition-none data-[state=active]:border-transparent",
            )}
            data-testid={option.testId}
          >
            {option.label}
            {option.scope === "uncommitted" ? (
              <span className="text-[10px] tabular-nums">{fileCount}</span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

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
  pushAheadCount,
  pushBehindCount,
  upstreamStatus,
}: {
  gitActionsLockReason: string | null | undefined;
  hasUncommittedFiles: boolean;
  isGitActionsLocked: boolean;
  isRebasing: boolean;
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
  if (upstreamStatus === "error") {
    return "Remote status is unavailable. Refresh before pulling.";
  }
  if (upstreamStatus === "untracked") {
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
  upstreamStatus,
}: {
  canPublishUntrackedBranch: boolean;
  gitActionsLockReason: string | null | undefined;
  hasUpstreamAhead: boolean;
  hasUpstreamBehind: boolean;
  isGitActionsLocked: boolean;
  isPushing: boolean;
  pushAheadCount: number | null;
  pushBehindCount: number | null;
  upstreamStatus: GitInfoHeaderProps["upstreamStatus"];
}): string => {
  if (isPushing) {
    return "Pushing";
  }
  if (isGitActionsLocked) {
    return gitActionsLockReason ?? "Git actions are disabled.";
  }
  if (canPublishUntrackedBranch) {
    return "Publish branch";
  }
  if (upstreamStatus === "error") {
    return "Remote status is unavailable. Refresh before pushing.";
  }
  if (pushAheadCount == null || pushBehindCount == null) {
    return "Checking remote status...";
  }
  if (hasUpstreamBehind) {
    return `Push branch (${pushBehindCount} behind; confirmation may be required)`;
  }
  if (hasUpstreamAhead) {
    return `Push branch (${pushAheadCount} ahead)`;
  }
  return "Branch is up to date with upstream";
};

type GitInfoHeaderStateInput = GitInfoHeaderProps & {
  branchKnown: boolean;
  targetBranchOptions: NonNullable<GitInfoHeaderProps["targetBranchOptions"]>;
};

const getGitInfoHeaderState = (props: GitInfoHeaderStateInput) => {
  const isRepositoryMode = props.contextMode === "repository";
  const trimmedTargetBranch = props.targetBranch.trim();
  const isDetachedHead = props.branch == null || props.branch.trim().length === 0;
  const hasTargetBranch = trimmedTargetBranch.length > 0;
  const rebaseBehindCount = props.commitsAheadBehind?.behind ?? null;
  const pushAheadCount = props.upstreamAheadBehind?.ahead ?? null;
  const pushBehindCount = props.upstreamAheadBehind?.behind ?? null;
  const hasUncommittedFiles = props.uncommittedFileCount > 0;
  const hasUpstreamAhead = pushAheadCount != null && pushAheadCount > 0;
  const hasUpstreamBehind = pushBehindCount != null && pushBehindCount > 0;
  const canPublishUntrackedBranch = props.upstreamStatus === "untracked";
  const hasPushAction = canPublishUntrackedBranch || hasUpstreamAhead || hasUpstreamBehind;
  const isCommitting = Boolean(props.isCommitting);
  const isGitActionsLocked = Boolean(props.isGitActionsLocked);
  const isPushing = Boolean(props.isPushing);
  const isRebasing = Boolean(props.isRebasing);
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing || Boolean(props.isResetting);
  const canRefresh = !props.isLoading && !isAnyActionInFlight;
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
    props.upstreamStatus !== "error" &&
    hasUpstreamBehind &&
    !hasUncommittedFiles &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    props.pullFromUpstream != null;
  const canPush =
    !isDetachedHead &&
    props.upstreamStatus !== "error" &&
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
    isRepositoryMode,
    pullTooltip: getPullTooltip({
      ...tooltipState,
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
      upstreamStatus: props.upstreamStatus,
    }),
    rebaseBehindCount,
    rebaseTooltip: getRebaseTooltip({ ...tooltipState, rebaseBehindCount }),
    showDetectPullRequest: props.pullRequest == null && props.onDetectPullRequest != null,
    targetBranchLabel: hasTargetBranch ? props.targetBranch : "No comparison target",
  };
};

function getBranchLabel(props: GitInfoHeaderStateInput): string {
  if (!props.branchKnown) return props.isLoading ? "Reading branch..." : "Branch unavailable";
  return props.branch?.trim() ? props.branch : "Detached HEAD";
}

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GitBranch,
  Link2,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Target,
  X,
} from "lucide-react";
import { memo, type ReactElement, useEffect, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import { cn } from "@/lib/utils";
import { DIFF_SCOPE_OPTIONS } from "./constants";
import type { AgentStudioGitPanelModel } from "./types";

type GitInfoHeaderProps = Pick<
  AgentStudioGitPanelModel,
  | "contextMode"
  | "pullRequest"
  | "branch"
  | "targetBranch"
  | "commitsAheadBehind"
  | "upstreamAheadBehind"
  | "upstreamStatus"
  | "diffScope"
  | "isLoading"
  | "isCommitting"
  | "isPushing"
  | "isRebasing"
  | "isDetectingPullRequest"
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
};

type GitActionIconButtonProps = {
  testId: string;
  srLabel: string;
  icon: typeof RefreshCw;
  onClick: (() => void) | null;
  disabled: boolean;
  tooltip: string;
  badge?:
    | {
        testId: string;
        value: number;
        toneClassName: string;
      }
    | undefined;
  isSpinning?: boolean;
  wrapTrigger?: boolean;
};

function GitActionIconButton({
  testId,
  srLabel,
  icon: Icon,
  onClick,
  disabled,
  tooltip,
  badge,
  isSpinning = false,
  wrapTrigger = false,
}: GitActionIconButtonProps): ReactElement {
  const button = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
      onClick={onClick ?? undefined}
      disabled={disabled}
      data-testid={testId}
    >
      <Icon className={cn("size-3.5", isSpinning ? "animate-spin" : "")} />
      {badge ? (
        <span
          className={cn(
            "pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums",
            badge.toneClassName,
          )}
          data-testid={badge.testId}
        >
          {badge.value}
        </span>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {wrapTrigger ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

type GitInfoHeaderSummaryRowProps = {
  isRepositoryMode: boolean;
  pullRequest: GitInfoHeaderProps["pullRequest"];
  uncommittedFileCount: number;
};

function GitInfoHeaderSummaryRow({
  isRepositoryMode,
  pullRequest,
  uncommittedFileCount,
}: GitInfoHeaderSummaryRowProps): ReactElement {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {isRepositoryMode ? "Repository context" : "Branch context"}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pullRequest ? <TaskPullRequestLink pullRequest={pullRequest} /> : null}
        <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
          {uncommittedFileCount} file{uncommittedFileCount === 1 ? "" : "s"} changed
        </Badge>
      </div>
    </div>
  );
}

type GitBranchContextRowProps = {
  canEditTargetBranch: boolean;
  currentBranchLabel: string;
  hasTargetAhead: boolean;
  isEditingTargetBranch: boolean;
  isRepositoryMode: boolean;
  isSavingTargetBranch: boolean;
  onCancelTargetBranchEdit: () => void;
  onEditTargetBranch: () => void;
  targetAheadCount: number | null;
  targetBranchLabel: string;
  targetBranchOptions: NonNullable<GitInfoHeaderProps["targetBranchOptions"]>;
  targetBranchSelectionValue: string;
  updateTargetBranchSelection: (selection: string) => void;
};

function GitBranchContextRow({
  canEditTargetBranch,
  currentBranchLabel,
  hasTargetAhead,
  isEditingTargetBranch,
  isRepositoryMode,
  isSavingTargetBranch,
  onCancelTargetBranchEdit,
  onEditTargetBranch,
  targetAheadCount,
  targetBranchLabel,
  targetBranchOptions,
  targetBranchSelectionValue,
  updateTargetBranchSelection,
}: GitBranchContextRowProps): ReactElement {
  return (
    <div
      className={cn(
        "mb-2 grid gap-2 px-3",
        isRepositoryMode
          ? "sm:grid-cols-[minmax(0,1fr)]"
          : "sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center",
      )}
      data-testid="agent-studio-git-branch-context-row"
    >
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {isRepositoryMode ? "Repository branch" : "Current branch"}
        </p>
        <div
          className="mt-1 flex h-5 min-w-0 items-center gap-1.5"
          data-testid="agent-studio-git-current-branch-display-row"
        >
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
            data-testid="agent-studio-git-current-branch"
          >
            {currentBranchLabel}
          </span>
        </div>
      </div>

      {isRepositoryMode ? null : (
        <>
          <div className="relative flex items-center justify-center" aria-hidden="true">
            <span className="inline-flex size-7 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
              <ArrowRight className="size-3.5" />
            </span>
            {hasTargetAhead ? (
              <span
                className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[13px] leading-none font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                data-testid="agent-studio-git-target-ahead-count"
              >
                {targetAheadCount}
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Target branch
            </p>
            {isEditingTargetBranch ? (
              <div
                className="mt-1 flex h-5 min-w-0 items-center gap-2"
                data-testid="agent-studio-git-target-branch-editor"
              >
                <div className="min-w-0 flex-1">
                  <BranchSelector
                    value={targetBranchSelectionValue}
                    options={targetBranchOptions}
                    className="w-full"
                    popoverClassName="w-[min(28rem,calc(100vw-2rem))] p-0"
                    triggerClassName="h-7 text-xs"
                    disabled={isSavingTargetBranch}
                    onValueChange={updateTargetBranchSelection}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={onCancelTargetBranchEdit}
                  disabled={isSavingTargetBranch}
                  data-testid="agent-studio-git-target-branch-cancel"
                >
                  {isSavingTargetBranch ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </Button>
              </div>
            ) : (
              <div
                className="mt-1 flex h-5 min-w-0 items-center gap-1.5"
                data-testid="agent-studio-git-target-branch-display-row"
              >
                <Target className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
                  data-testid="agent-studio-git-target-branch"
                >
                  {targetBranchLabel}
                </span>
                {canEditTargetBranch ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-7 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={onEditTargetBranch}
                    data-testid="agent-studio-git-target-branch-edit"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type GitActionRowProps = {
  canPull: boolean;
  canPush: boolean;
  canRebase: boolean;
  canRefresh: boolean;
  isDetectingPullRequest: boolean;
  isLoading: boolean;
  isPushing: boolean;
  isRepositoryMode: boolean;
  onDetectPullRequest?: (() => Promise<void> | void) | null | undefined;
  onRefresh: () => void;
  pullFromUpstream: (() => Promise<void>) | null;
  pullTooltip: string;
  pushAheadCount: number | null;
  pushBehindCount: number | null;
  pushBranch: (() => Promise<void>) | null;
  pushTooltip: string;
  rebaseBehindCount: number | null;
  rebaseOntoTarget: (() => Promise<void>) | null;
  rebaseTooltip: string;
  showDetectPullRequest: boolean;
};

function GitActionRow({
  canPull,
  canPush,
  canRebase,
  canRefresh,
  isDetectingPullRequest,
  isLoading,
  isPushing,
  isRepositoryMode,
  onDetectPullRequest,
  onRefresh,
  pullFromUpstream,
  pullTooltip,
  pushAheadCount,
  pushBehindCount,
  pushBranch,
  pushTooltip,
  rebaseBehindCount,
  rebaseOntoTarget,
  rebaseTooltip,
  showDetectPullRequest,
}: GitActionRowProps): ReactElement {
  return (
    <div
      className="flex items-center justify-between gap-2 border-y border-border py-1"
      data-testid="agent-studio-git-action-row"
    >
      <div className="inline-flex items-center gap-0.5 px-1">
        <GitActionIconButton
          testId="agent-studio-git-refresh-button"
          srLabel="Refresh"
          icon={RefreshCw}
          onClick={onRefresh}
          disabled={!canRefresh}
          tooltip={isLoading ? "Refreshing" : "Refresh changes"}
          isSpinning={isLoading}
        />
        {isRepositoryMode ? null : (
          <GitActionIconButton
            testId="agent-studio-git-rebase-button"
            srLabel="Rebase onto target"
            icon={Target}
            onClick={rebaseOntoTarget ? () => void rebaseOntoTarget() : null}
            disabled={!canRebase}
            tooltip={rebaseTooltip}
            badge={
              rebaseBehindCount != null && rebaseBehindCount > 0
                ? {
                    testId: "agent-studio-git-behind-count",
                    value: rebaseBehindCount,
                    toneClassName: "text-rose-600 dark:text-rose-400",
                  }
                : undefined
            }
            wrapTrigger
          />
        )}
        <span className="inline-flex" data-testid="agent-studio-git-pull-tooltip-trigger">
          <GitActionIconButton
            testId="agent-studio-git-pull-button"
            srLabel="Pull from upstream"
            icon={ArrowDown}
            onClick={pullFromUpstream ? () => void pullFromUpstream() : null}
            disabled={!canPull}
            tooltip={pullTooltip}
            badge={
              pushBehindCount != null && pushBehindCount > 0
                ? {
                    testId: "agent-studio-git-upstream-behind-count",
                    value: pushBehindCount,
                    toneClassName: "text-rose-600 dark:text-rose-400",
                  }
                : undefined
            }
            wrapTrigger
          />
        </span>
        <GitActionIconButton
          testId="agent-studio-git-push-button"
          srLabel="Push branch"
          icon={isPushing ? LoaderCircle : ArrowUp}
          onClick={pushBranch ? () => void pushBranch() : null}
          disabled={!canPush}
          tooltip={pushTooltip}
          badge={
            pushAheadCount != null && pushAheadCount > 0
              ? {
                  testId: "agent-studio-git-ahead-count",
                  value: pushAheadCount ?? 0,
                  toneClassName: "text-emerald-600 dark:text-emerald-400",
                }
              : undefined
          }
          isSpinning={isPushing}
        />
      </div>
      {showDetectPullRequest ? (
        <div className="inline-flex items-center px-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => void onDetectPullRequest?.()}
            disabled={Boolean(isDetectingPullRequest)}
            data-testid="agent-studio-git-detect-pr-button"
          >
            <Link2 data-icon="inline-start" />
            {isDetectingPullRequest ? "Detecting PR" : "Detect PR"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type GitDiffScopeTabsProps = {
  diffScope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
};

function GitDiffScopeTabs({ diffScope, onScopeChange }: GitDiffScopeTabsProps): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <Tabs
        value={diffScope}
        onValueChange={(value) => {
          if (value === "target" || value === "uncommitted") {
            onScopeChange(value);
          }
        }}
        className="gap-0"
      >
        <TabsList
          aria-label="Git diff scope"
          className="inline-flex h-9 w-full items-center gap-1 rounded-none bg-muted p-1"
        >
          {DIFF_SCOPE_OPTIONS.map((option) => (
            <TabsTrigger
              key={option.scope}
              value={option.scope}
              className={cn(
                "inline-flex h-7 flex-1 cursor-pointer justify-center rounded-sm px-3 text-xs",
                "border-none bg-transparent data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm",
                "text-muted-foreground hover:bg-background/80 hover:text-foreground data-[state=active]:border-transparent",
              )}
              data-testid={option.testId}
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

type GitInfoHeaderErrorsProps = {
  pushError: string | null;
  rebaseError: string | null;
};

function GitInfoHeaderErrors({
  pushError,
  rebaseError,
}: GitInfoHeaderErrorsProps): ReactElement | null {
  if (!rebaseError && !pushError) {
    return null;
  }

  return (
    <>
      {rebaseError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-rebase-error">
          {rebaseError}
        </p>
      ) : null}
      {pushError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-push-error">
          {pushError}
        </p>
      ) : null}
    </>
  );
}

export const GitInfoHeader = memo(function GitInfoHeader({
  contextMode = "worktree",
  pullRequest,
  branch,
  targetBranch,
  commitsAheadBehind,
  upstreamAheadBehind,
  upstreamStatus,
  diffScope,
  uncommittedFileCount,
  isLoading,
  isCommitting,
  isPushing,
  isRebasing,
  isDetectingPullRequest,
  isGitActionsLocked,
  gitActionsLockReason,
  showLockReasonBanner,
  pushError,
  rebaseError,
  pushBranch,
  rebaseOntoTarget,
  pullFromUpstream,
  onDetectPullRequest,
  setDiffScope,
  onRefresh,
  targetBranchOptions = [],
  targetBranchSelectionValue = "",
  onUpdateTargetBranch,
}: GitInfoHeaderProps): ReactElement {
  const [isEditingTargetBranch, setIsEditingTargetBranch] = useState(false);
  const [targetBranchDraft, setTargetBranchDraft] = useState(targetBranchSelectionValue);
  const [isSavingTargetBranch, setIsSavingTargetBranch] = useState(false);
  const showDetectPullRequest = pullRequest == null && onDetectPullRequest != null;
  const isRepositoryMode = contextMode === "repository";
  const trimmedTargetBranch = targetBranch.trim();
  const isDetachedHead = branch == null || branch.trim().length === 0;
  const currentBranchLabel = isDetachedHead ? "Detached HEAD" : branch;
  const hasTargetBranch = trimmedTargetBranch.length > 0;
  const targetBranchLabel = hasTargetBranch ? targetBranch : "No comparison target";
  const targetAheadCount = commitsAheadBehind?.ahead ?? null;
  const rebaseBehindCount = commitsAheadBehind?.behind ?? null;
  const pushAheadCount = upstreamAheadBehind?.ahead ?? null;
  const pushBehindCount = upstreamAheadBehind?.behind ?? null;
  const hasTargetAhead = targetAheadCount != null && targetAheadCount > 0;
  const hasUncommittedFiles = uncommittedFileCount > 0;
  const hasUpstreamAhead = pushAheadCount != null && pushAheadCount > 0;
  const hasUpstreamBehind = pushBehindCount != null && pushBehindCount > 0;
  const canPublishUntrackedBranch = upstreamStatus === "untracked";
  const hasPushAction = canPublishUntrackedBranch || hasUpstreamAhead || hasUpstreamBehind;
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing;
  const canRefresh = !isLoading && !isAnyActionInFlight;
  const canRebase =
    !isRepositoryMode &&
    !isDetachedHead &&
    hasTargetBranch &&
    !hasUncommittedFiles &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    rebaseOntoTarget != null;
  const canPull =
    !isDetachedHead &&
    hasUpstreamBehind &&
    !hasUncommittedFiles &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    pullFromUpstream != null;
  const canPush =
    !isDetachedHead &&
    hasPushAction &&
    !isAnyActionInFlight &&
    !isGitActionsLocked &&
    pushBranch != null;
  const rebaseTooltip = isRebasing
    ? "Rebasing"
    : isGitActionsLocked
      ? (gitActionsLockReason ?? "Git actions are disabled.")
      : hasUncommittedFiles
        ? "Commit or stash changes before rebasing"
        : rebaseBehindCount != null && rebaseBehindCount > 0
          ? `Rebase onto target (${rebaseBehindCount} behind)`
          : "Rebase onto target";
  const pullTooltip = isRebasing
    ? "Pulling"
    : isGitActionsLocked
      ? (gitActionsLockReason ?? "Git actions are disabled.")
      : isRepositoryMode && upstreamStatus === "untracked"
        ? "No upstream branch yet. Push this branch first to create it."
        : hasUncommittedFiles
          ? "Commit or stash changes before pulling"
          : pushAheadCount != null &&
              pushAheadCount > 0 &&
              pushBehindCount != null &&
              pushBehindCount > 0
            ? `Pull with rebase (${pushBehindCount} behind; ${pushAheadCount} local commit${pushAheadCount === 1 ? "" : "s"} will be rewritten)`
            : pushBehindCount != null && pushBehindCount > 0
              ? `Pull (${pushBehindCount} behind)`
              : "Pull";
  const pushTooltip = isPushing
    ? "Pushing"
    : isGitActionsLocked
      ? (gitActionsLockReason ?? "Git actions are disabled.")
      : canPublishUntrackedBranch
        ? "Publish branch"
        : hasUpstreamBehind
          ? `Push branch (${pushBehindCount} behind; confirmation may be required)`
          : hasUpstreamAhead
            ? `Push branch (${pushAheadCount} ahead)`
            : "Branch is up to date with upstream";
  const canEditTargetBranch =
    !isRepositoryMode && onUpdateTargetBranch != null && targetBranchOptions.length > 0;

  useEffect(() => {
    if (!isEditingTargetBranch) {
      setTargetBranchDraft(targetBranchSelectionValue);
    }
  }, [isEditingTargetBranch, targetBranchSelectionValue]);

  const handleScopeChange = (scope: DiffScope): void => {
    if (diffScope === scope) {
      return;
    }
    setDiffScope(scope);
  };

  const handleEditTargetBranch = (): void => {
    if (!canEditTargetBranch || isSavingTargetBranch) {
      return;
    }

    setTargetBranchDraft(targetBranchSelectionValue);
    setIsEditingTargetBranch(true);
  };

  const handleCancelTargetBranchEdit = (): void => {
    if (isSavingTargetBranch) {
      return;
    }

    setTargetBranchDraft(targetBranchSelectionValue);
    setIsEditingTargetBranch(false);
  };

  const handleSelectTargetBranch = (selection: string): void => {
    if (!onUpdateTargetBranch || isSavingTargetBranch) {
      return;
    }

    setTargetBranchDraft(selection);

    if (selection === targetBranchSelectionValue) {
      setIsEditingTargetBranch(false);
      return;
    }

    setIsSavingTargetBranch(true);
    void onUpdateTargetBranch(selection)
      .then(
        () => {
          setIsEditingTargetBranch(false);
        },
        () => {
          // Task operations already surface actionable errors.
        },
      )
      .finally(() => {
        setIsSavingTargetBranch(false);
      });
  };

  return (
    <div className="flex flex-col border-b border-border">
      <GitInfoHeaderSummaryRow
        isRepositoryMode={isRepositoryMode}
        pullRequest={pullRequest}
        uncommittedFileCount={uncommittedFileCount}
      />

      <GitBranchContextRow
        canEditTargetBranch={canEditTargetBranch}
        currentBranchLabel={currentBranchLabel}
        hasTargetAhead={hasTargetAhead}
        isEditingTargetBranch={isEditingTargetBranch && canEditTargetBranch}
        isRepositoryMode={isRepositoryMode}
        isSavingTargetBranch={isSavingTargetBranch}
        onCancelTargetBranchEdit={handleCancelTargetBranchEdit}
        onEditTargetBranch={handleEditTargetBranch}
        targetAheadCount={targetAheadCount}
        targetBranchLabel={targetBranchLabel}
        targetBranchOptions={targetBranchOptions}
        targetBranchSelectionValue={targetBranchDraft}
        updateTargetBranchSelection={handleSelectTargetBranch}
      />

      <GitActionRow
        canPull={canPull}
        canPush={canPush}
        canRebase={canRebase}
        canRefresh={canRefresh}
        isDetectingPullRequest={Boolean(isDetectingPullRequest)}
        isLoading={isLoading}
        isPushing={Boolean(isPushing)}
        isRepositoryMode={isRepositoryMode}
        onDetectPullRequest={onDetectPullRequest}
        onRefresh={onRefresh}
        pullFromUpstream={pullFromUpstream}
        pullTooltip={pullTooltip}
        pushAheadCount={pushAheadCount}
        pushBehindCount={pushBehindCount}
        pushBranch={pushBranch}
        pushTooltip={pushTooltip}
        rebaseBehindCount={rebaseBehindCount}
        rebaseOntoTarget={rebaseOntoTarget}
        rebaseTooltip={rebaseTooltip}
        showDetectPullRequest={showDetectPullRequest}
      />

      {showLockReasonBanner && isGitActionsLocked && gitActionsLockReason ? (
        <div
          className="border-y border-border bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="agent-studio-git-lock-reason"
        >
          {gitActionsLockReason}
        </div>
      ) : null}

      <GitDiffScopeTabs diffScope={diffScope} onScopeChange={handleScopeChange} />
      <GitInfoHeaderErrors pushError={pushError ?? null} rebaseError={rebaseError ?? null} />
    </div>
  );
});

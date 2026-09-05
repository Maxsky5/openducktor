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
import { memo, type ReactElement, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
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
import type { AgentStudioGitPanelModel } from "./types";

const TARGET_BRANCH_LABEL_ID = "agent-studio-git-target-branch-label";

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
  const tooltipDescriptionId = `${testId}-tooltip-description`;
  const button = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
      onClick={onClick ?? undefined}
      disabled={disabled}
      data-testid={testId}
      aria-describedby={tooltipDescriptionId}
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
    <>
      <span id={tooltipDescriptionId} className="sr-only">
        {tooltip}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          {wrapTrigger ? <span className="inline-flex">{button}</span> : button}
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

type GitBranchContextRowProps = {
  currentBranchLabel: string;
  branchState: {
    hasTargetAhead: boolean;
    isRepositoryMode: boolean;
  };
  canEditTargetBranch: boolean;
  targetAheadCount: number | null;
  targetBranchLabel: string;
  targetBranchOptions: NonNullable<GitInfoHeaderProps["targetBranchOptions"]>;
  targetBranchSelectionValue: string;
  onUpdateTargetBranch: GitInfoHeaderProps["onUpdateTargetBranch"];
};

type TargetBranchEditorState =
  | { mode: "display" }
  | {
      mode: "editing";
      draft: string;
      isSaving: boolean;
    };

type GitTargetBranchPanelProps = {
  canEditTargetBranch: boolean;
  targetBranchLabel: string;
  targetBranchOptions: NonNullable<GitInfoHeaderProps["targetBranchOptions"]>;
  targetBranchSelectionValue: string;
  onUpdateTargetBranch: GitInfoHeaderProps["onUpdateTargetBranch"];
};

function GitTargetBranchPanel({
  canEditTargetBranch,
  targetBranchLabel,
  targetBranchOptions,
  targetBranchSelectionValue,
  onUpdateTargetBranch,
}: GitTargetBranchPanelProps): ReactElement {
  const [editorState, setEditorState] = useState<TargetBranchEditorState>({ mode: "display" });
  const isEditorOpen = canEditTargetBranch && editorState.mode === "editing";
  const isSavingTargetBranch = isEditorOpen ? editorState.isSaving : false;
  const displayedSelectionValue = isEditorOpen ? editorState.draft : targetBranchSelectionValue;

  const handleEditTargetBranch = (): void => {
    if (!canEditTargetBranch || isSavingTargetBranch) {
      return;
    }

    setEditorState({
      mode: "editing",
      draft: targetBranchSelectionValue,
      isSaving: false,
    });
  };

  const handleCancelTargetBranchEdit = (): void => {
    if (isSavingTargetBranch) {
      return;
    }

    setEditorState({ mode: "display" });
  };

  const handleSelectTargetBranch = (selection: string): void => {
    if (!onUpdateTargetBranch || editorState.mode !== "editing" || editorState.isSaving) {
      return;
    }

    if (selection === targetBranchSelectionValue) {
      setEditorState({ mode: "display" });
      return;
    }

    setEditorState({
      mode: "editing",
      draft: selection,
      isSaving: true,
    });

    void onUpdateTargetBranch(selection).then(
      () => {
        setEditorState({ mode: "display" });
      },
      () => {
        // Task operations already surface actionable errors.
        setEditorState({
          mode: "editing",
          draft: selection,
          isSaving: false,
        });
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p
        id={TARGET_BRANCH_LABEL_ID}
        className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        Target branch
      </p>
      {isEditorOpen ? (
        <div
          className="mt-1 flex h-7 min-w-0 items-center gap-2"
          data-testid="agent-studio-git-target-branch-editor"
        >
          <div className="min-w-0 flex-1">
            <BranchSelector
              value={displayedSelectionValue}
              options={targetBranchOptions}
              triggerAriaLabelledBy={TARGET_BRANCH_LABEL_ID}
              className="w-full"
              popoverClassName="w-[min(28rem,calc(100vw-2rem))] p-0"
              triggerClassName="h-7 text-xs"
              disabled={isSavingTargetBranch}
              onValueChange={handleSelectTargetBranch}
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Cancel target branch edit"
            onClick={handleCancelTargetBranchEdit}
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
          className="mt-1 flex h-7 min-w-0 items-center gap-1.5"
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
              aria-label="Edit target branch"
              onClick={handleEditTargetBranch}
              data-testid="agent-studio-git-target-branch-edit"
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function GitBranchContextRow({
  currentBranchLabel,
  branchState,
  canEditTargetBranch,
  targetAheadCount,
  targetBranchLabel,
  targetBranchOptions,
  targetBranchSelectionValue,
  onUpdateTargetBranch,
}: GitBranchContextRowProps): ReactElement {
  const { hasTargetAhead, isRepositoryMode } = branchState;
  return (
    <div
      className={cn(
        "my-2 grid gap-2 px-3",
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
          className="mt-1 flex h-7 min-w-0 items-center gap-1.5"
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

          <GitTargetBranchPanel
            key={canEditTargetBranch ? "editable" : "readonly"}
            canEditTargetBranch={canEditTargetBranch}
            targetBranchLabel={targetBranchLabel}
            targetBranchOptions={targetBranchOptions}
            targetBranchSelectionValue={targetBranchSelectionValue}
            onUpdateTargetBranch={onUpdateTargetBranch}
          />
        </>
      )}
    </div>
  );
}

type GitActionRowProps = {
  actionState: {
    canPull: boolean;
    canPush: boolean;
    canRebase: boolean;
    canRefresh: boolean;
    isDetectingPullRequest: boolean;
    isLoading: boolean;
    isPushing: boolean;
    isRepositoryMode: boolean;
    showDetectPullRequest: boolean;
    detectPullRequestDisabledReason: string | null;
  };
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
};

type GitSyncActionsProps = Omit<GitActionRowProps, "actionState" | "onDetectPullRequest"> & {
  actionState: Pick<
    GitActionRowProps["actionState"],
    | "canPull"
    | "canPush"
    | "canRebase"
    | "canRefresh"
    | "isLoading"
    | "isPushing"
    | "isRepositoryMode"
  >;
};

function GitSyncActions({
  actionState,
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
}: GitSyncActionsProps): ReactElement {
  const { canPull, canPush, canRebase, canRefresh, isLoading, isPushing, isRepositoryMode } =
    actionState;
  return (
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
                value: pushAheadCount,
                toneClassName: "text-emerald-600 dark:text-emerald-400",
              }
            : undefined
        }
        isSpinning={isPushing}
      />
    </div>
  );
}

function DetectPullRequestAction({
  disabledReason,
  isDetecting,
  onDetect,
}: {
  disabledReason: string | null;
  isDetecting: boolean;
  onDetect?: (() => Promise<void> | void) | null | undefined;
}): ReactElement {
  const errorId = disabledReason ? "agent-studio-git-detect-pr-error" : undefined;
  return (
    <div className="flex flex-col items-end gap-1 px-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => void onDetect?.()}
        disabled={isDetecting || disabledReason !== null}
        aria-describedby={errorId}
        data-testid="agent-studio-git-detect-pr-button"
      >
        <Link2 data-icon="inline-start" />
        {isDetecting ? "Detecting PR" : "Detect PR"}
      </Button>
      {disabledReason ? (
        <p id={errorId} className="max-w-72 text-right text-xs text-destructive">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

function GitActionRow({ actionState, onDetectPullRequest, ...syncProps }: GitActionRowProps) {
  return (
    <div
      className="flex items-center justify-between gap-2 border-y border-border py-1"
      data-testid="agent-studio-git-action-row"
    >
      <GitSyncActions actionState={actionState} {...syncProps} />
      {actionState.showDetectPullRequest ? (
        <DetectPullRequestAction
          disabledReason={actionState.detectPullRequestDisabledReason}
          isDetecting={actionState.isDetectingPullRequest}
          onDetect={onDetectPullRequest}
        />
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
          className={segmentedControlRootClassName({
            size: "sm",
            className: "w-full rounded-none",
          })}
        >
          {DIFF_SCOPE_OPTIONS.map((option) => (
            <TabsTrigger
              key={option.scope}
              value={option.scope}
              className={cn(
                segmentedControlTriggerClassName({
                  size: "sm",
                  inactiveClassName: "hover:bg-background/80",
                }),
                "border-none bg-transparent transition-none data-[state=active]:border-transparent",
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
    return "Publish branch";
  }
  if (hasUpstreamBehind) {
    return `Push branch (${pushBehindCount} behind; confirmation may be required)`;
  }
  if (hasUpstreamAhead) {
    return `Push branch (${pushAheadCount} ahead)`;
  }
  return "Branch is up to date with upstream";
};

type GitInfoHeaderStateInput = {
  branch: GitInfoHeaderProps["branch"];
  commitsAheadBehind: GitInfoHeaderProps["commitsAheadBehind"];
  contextMode: GitInfoHeaderProps["contextMode"];
  gitActionsLockReason: GitInfoHeaderProps["gitActionsLockReason"];
  isCommitting: boolean | undefined;
  isGitActionsLocked: boolean | undefined;
  isLoading: boolean;
  isPushing: boolean | undefined;
  isRebasing: boolean | undefined;
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

const getGitInfoHeaderState = (props: GitInfoHeaderStateInput) => {
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
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing;
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
    canEditTargetBranch:
      !isRepositoryMode &&
      props.onUpdateTargetBranch != null &&
      props.targetBranchOptions.length > 0,
    canPull,
    canPush,
    canRebase,
    canRefresh,
    currentBranchLabel: isDetachedHead ? "Detached HEAD" : (props.branch ?? ""),
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
  detectPullRequestDisabledReason,
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
  const state = getGitInfoHeaderState({
    contextMode,
    pullRequest,
    branch,
    targetBranch,
    commitsAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    uncommittedFileCount,
    isLoading,
    isCommitting,
    isPushing,
    isRebasing,
    isGitActionsLocked,
    gitActionsLockReason,
    pushBranch,
    rebaseOntoTarget,
    pullFromUpstream,
    onDetectPullRequest,
    targetBranchOptions,
    onUpdateTargetBranch,
  });

  const handleScopeChange = (scope: DiffScope): void => {
    if (diffScope === scope) {
      return;
    }
    setDiffScope(scope);
  };

  return (
    <div className="flex flex-col border-b border-border">
      <GitBranchContextRow
        currentBranchLabel={state.currentBranchLabel}
        branchState={{
          hasTargetAhead: state.hasTargetAhead,
          isRepositoryMode: state.isRepositoryMode,
        }}
        canEditTargetBranch={state.canEditTargetBranch}
        targetAheadCount={state.targetAheadCount}
        targetBranchLabel={state.targetBranchLabel}
        targetBranchOptions={targetBranchOptions}
        targetBranchSelectionValue={targetBranchSelectionValue}
        onUpdateTargetBranch={onUpdateTargetBranch}
      />

      <GitActionRow
        actionState={{
          canPull: state.canPull,
          canPush: state.canPush,
          canRebase: state.canRebase,
          canRefresh: state.canRefresh,
          isDetectingPullRequest: Boolean(isDetectingPullRequest),
          isLoading,
          isPushing: Boolean(isPushing),
          isRepositoryMode: state.isRepositoryMode,
          showDetectPullRequest: state.showDetectPullRequest,
          detectPullRequestDisabledReason: detectPullRequestDisabledReason ?? null,
        }}
        onDetectPullRequest={onDetectPullRequest}
        onRefresh={onRefresh}
        pullFromUpstream={pullFromUpstream}
        pullTooltip={state.pullTooltip}
        pushAheadCount={state.pushAheadCount}
        pushBehindCount={state.pushBehindCount}
        pushBranch={pushBranch}
        pushTooltip={state.pushTooltip}
        rebaseBehindCount={state.rebaseBehindCount}
        rebaseOntoTarget={rebaseOntoTarget}
        rebaseTooltip={state.rebaseTooltip}
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

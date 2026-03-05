import { ArrowDown, ArrowRight, ArrowUp, GitBranch, RefreshCw, Target } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DiffScope } from "@/pages/agents/use-agent-studio-diff-data";
import { DIFF_SCOPE_OPTIONS } from "./constants";
import type { AgentStudioGitPanelModel } from "./types";

type GitInfoHeaderProps = Pick<
  AgentStudioGitPanelModel,
  | "branch"
  | "targetBranch"
  | "commitsAheadBehind"
  | "upstreamAheadBehind"
  | "diffScope"
  | "isLoading"
  | "isCommitting"
  | "isPushing"
  | "isRebasing"
  | "isGitActionsLocked"
  | "gitActionsLockReason"
  | "showLockReasonBanner"
  | "pushError"
  | "rebaseError"
  | "setDiffScope"
> & {
  uncommittedFileCount: number;
  pushBranch: (() => Promise<void>) | null;
  rebaseOntoTarget: (() => Promise<void>) | null;
  pullFromUpstream: (() => Promise<void>) | null;
  onRefresh: () => void;
};

export function GitInfoHeader({
  branch,
  targetBranch,
  commitsAheadBehind,
  upstreamAheadBehind,
  diffScope,
  uncommittedFileCount,
  isLoading,
  isCommitting,
  isPushing,
  isRebasing,
  isGitActionsLocked,
  gitActionsLockReason,
  showLockReasonBanner,
  pushError,
  rebaseError,
  pushBranch,
  rebaseOntoTarget,
  pullFromUpstream,
  setDiffScope,
  onRefresh,
}: GitInfoHeaderProps): ReactElement {
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
  const hasUpstreamBehind = pushBehindCount != null && pushBehindCount > 0;
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing;
  const canRefresh = !isLoading && !isAnyActionInFlight;
  const canRebase =
    !isDetachedHead &&
    hasTargetBranch &&
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
    !isDetachedHead && !isAnyActionInFlight && !isGitActionsLocked && pushBranch != null;

  const handleScopeChange = (scope: DiffScope): void => {
    if (diffScope === scope) {
      return;
    }
    setDiffScope(scope);
  };

  return (
    <div className="space-y-0 border-b border-border">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Branch context
        </span>
        <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
          {uncommittedFileCount} file{uncommittedFileCount === 1 ? "" : "s"} changed
        </Badge>
      </div>

      <div
        className="mb-2 grid gap-2 px-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center"
        data-testid="agent-studio-git-branch-context-row"
      >
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Current branch
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="truncate font-mono text-xs text-foreground"
              data-testid="agent-studio-git-current-branch"
            >
              {currentBranchLabel}
            </span>
          </div>
        </div>

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
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <Target className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="truncate font-mono text-xs text-foreground"
              data-testid="agent-studio-git-target-branch"
            >
              {targetBranchLabel}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-between gap-2 border-y border-border py-1"
        data-testid="agent-studio-git-action-row"
      >
        <div className="inline-flex items-center gap-0.5 px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                onClick={onRefresh}
                disabled={!canRefresh}
                data-testid="agent-studio-git-refresh-button"
              >
                <RefreshCw className={cn("size-3.5", isLoading ? "animate-spin" : "")} />
                <span className="sr-only">Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{isLoading ? "Refreshing" : "Refresh changes"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                onClick={() => void rebaseOntoTarget?.()}
                disabled={!canRebase}
                data-testid="agent-studio-git-rebase-button"
              >
                <Target className="size-3.5" />
                {rebaseBehindCount != null && rebaseBehindCount > 0 ? (
                  <span
                    className="pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums text-rose-600 dark:text-rose-400"
                    data-testid="agent-studio-git-behind-count"
                  >
                    {rebaseBehindCount}
                  </span>
                ) : null}
                <span className="sr-only">Rebase onto target</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {isRebasing
                  ? "Rebasing"
                  : isGitActionsLocked
                    ? (gitActionsLockReason ?? "Git actions are disabled.")
                    : rebaseBehindCount != null && rebaseBehindCount > 0
                      ? `Rebase onto target (${rebaseBehindCount} behind)`
                      : "Rebase onto target"}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex" data-testid="agent-studio-git-pull-tooltip-trigger">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                  onClick={() => void pullFromUpstream?.()}
                  disabled={!canPull}
                  data-testid="agent-studio-git-pull-button"
                >
                  <ArrowDown className="size-3.5" />
                  {pushBehindCount != null && pushBehindCount > 0 ? (
                    <span
                      className="pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums text-rose-600 dark:text-rose-400"
                      data-testid="agent-studio-git-upstream-behind-count"
                    >
                      {pushBehindCount}
                    </span>
                  ) : null}
                  <span className="sr-only">Pull from upstream</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {isRebasing
                  ? "Pulling"
                  : isGitActionsLocked
                    ? (gitActionsLockReason ?? "Git actions are disabled.")
                    : hasUncommittedFiles
                      ? "Commit or stash changes before pulling"
                      : pushAheadCount != null &&
                          pushAheadCount > 0 &&
                          pushBehindCount != null &&
                          pushBehindCount > 0
                        ? `Pull with rebase (${pushBehindCount} behind; ${pushAheadCount} local commit${pushAheadCount === 1 ? "" : "s"} will be rewritten)`
                        : pushBehindCount != null && pushBehindCount > 0
                          ? `Pull (${pushBehindCount} behind)`
                          : "Pull"}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                onClick={() => void pushBranch?.()}
                disabled={!canPush}
                data-testid="agent-studio-git-push-button"
              >
                <ArrowUp className="size-3.5" />
                {pushAheadCount != null && pushAheadCount > 0 ? (
                  <span
                    className="pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                    data-testid="agent-studio-git-ahead-count"
                  >
                    {pushAheadCount}
                  </span>
                ) : null}
                <span className="sr-only">Push branch</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {isPushing
                  ? "Pushing"
                  : isGitActionsLocked
                    ? (gitActionsLockReason ?? "Git actions are disabled.")
                    : hasUpstreamBehind
                      ? `Push branch (${pushBehindCount} behind; confirmation may be required)`
                      : pushAheadCount != null && pushAheadCount > 0
                        ? `Push branch (${pushAheadCount} ahead)`
                        : "Push branch"}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {showLockReasonBanner && isGitActionsLocked && gitActionsLockReason ? (
        <div
          className="border-y border-border bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="agent-studio-git-lock-reason"
        >
          {gitActionsLockReason}
        </div>
      ) : null}

      <div className="space-y-1">
        <div
          className="inline-flex h-9 w-full items-center bg-muted p-1 gap-1"
          role="tablist"
          aria-label="Git diff scope"
        >
          {DIFF_SCOPE_OPTIONS.map((option) => {
            const isActive = diffScope === option.scope;
            return (
              <button
                key={option.scope}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "inline-flex h-7 flex-1 items-center justify-center rounded-sm px-3 text-xs transition-colors cursor-pointer",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
                )}
                onClick={() => handleScopeChange(option.scope)}
                data-testid={option.testId}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}

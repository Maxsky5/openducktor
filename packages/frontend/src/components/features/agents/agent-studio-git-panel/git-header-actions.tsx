import { ArrowDown, ArrowUp, Link2, LoaderCircle, RefreshCw, Target } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DETECT_PR_ERROR_ID } from "./git-header-notices";

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
      className="relative size-8 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
      onClick={onClick ?? undefined}
      disabled={disabled}
      data-testid={testId}
      aria-describedby={tooltipDescriptionId}
      aria-busy={isSpinning || undefined}
    >
      <Icon className={cn("size-3.5", isSpinning ? "animate-spin" : "")} />
      {badge ? (
        <span
          className={cn(
            "pointer-events-none absolute top-0.5 right-0.5 text-[10px] leading-none font-bold tabular-nums",
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
        <TooltipContent side="bottom">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

export type GitActionRowProps = {
  actionState: {
    canPull: boolean;
    canPush: boolean;
    canRebase: boolean;
    canRefresh: boolean;
    isDetectingPullRequest: boolean;
    isRefreshing: boolean;
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

function DetectPullRequestAction({
  disabledReason,
  isDetecting,
  onDetect,
}: {
  disabledReason: string | null;
  isDetecting: boolean;
  onDetect?: (() => Promise<void> | void) | null | undefined;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
      onClick={() => void onDetect?.()}
      disabled={isDetecting || disabledReason !== null}
      aria-label={isDetecting ? "Detecting PR" : "Detect PR"}
      aria-describedby={disabledReason ? DETECT_PR_ERROR_ID : undefined}
      title={disabledReason ?? "Detect the pull request of this branch"}
      data-testid="agent-studio-git-detect-pr-button"
    >
      {isDetecting ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <Link2 className="size-3.5" />
      )}
    </Button>
  );
}

const BEHIND_TONE = "text-rose-600 dark:text-rose-400";
const AHEAD_TONE = "text-emerald-600 dark:text-emerald-400";

/** A count badge, or nothing when there is no count to show. */
const countBadge = (testId: string, value: number | null, toneClassName: string) =>
  value != null && value > 0 ? { testId, value, toneClassName } : undefined;

const runAction = (action: (() => Promise<void>) | null) => (action ? () => void action() : null);

function RefreshAction({
  canRefresh,
  isRefreshing,
  onRefresh,
}: {
  canRefresh: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}): ReactElement {
  return (
    <GitActionIconButton
      testId="agent-studio-git-refresh-button"
      srLabel={isRefreshing ? "Refreshing" : "Refresh"}
      icon={RefreshCw}
      onClick={onRefresh}
      disabled={!canRefresh}
      tooltip={isRefreshing ? "Refreshing Git changes" : "Refresh and fetch the remote"}
      isSpinning={isRefreshing}
    />
  );
}

/** One row of icon actions under the branches: Refresh, Rebase, Pull, and Push, then Detect PR. */
export function GitActionRow({
  actionState,
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
}: GitActionRowProps): ReactElement {
  const { canPull, canPush, canRebase, isPushing, isRepositoryMode } = actionState;
  return (
    <div
      className="flex items-center gap-0.5 border-y border-border/60 px-1.5 py-0.5"
      data-testid="agent-studio-git-action-row"
    >
      <RefreshAction
        canRefresh={actionState.canRefresh}
        isRefreshing={actionState.isRefreshing}
        onRefresh={onRefresh}
      />
      {isRepositoryMode ? null : (
        <GitActionIconButton
          testId="agent-studio-git-rebase-button"
          srLabel="Rebase onto target"
          icon={Target}
          onClick={runAction(rebaseOntoTarget)}
          disabled={!canRebase}
          tooltip={rebaseTooltip}
          badge={countBadge("agent-studio-git-behind-count", rebaseBehindCount, BEHIND_TONE)}
          wrapTrigger
        />
      )}
      <span className="inline-flex" data-testid="agent-studio-git-pull-tooltip-trigger">
        <GitActionIconButton
          testId="agent-studio-git-pull-button"
          srLabel="Pull from upstream"
          icon={ArrowDown}
          onClick={runAction(pullFromUpstream)}
          disabled={!canPull}
          tooltip={pullTooltip}
          badge={countBadge("agent-studio-git-upstream-behind-count", pushBehindCount, BEHIND_TONE)}
          wrapTrigger
        />
      </span>
      <GitActionIconButton
        testId="agent-studio-git-push-button"
        srLabel="Push branch"
        icon={isPushing ? LoaderCircle : ArrowUp}
        onClick={runAction(pushBranch)}
        disabled={!canPush}
        tooltip={pushTooltip}
        badge={countBadge("agent-studio-git-ahead-count", pushAheadCount, AHEAD_TONE)}
        isSpinning={isPushing}
      />
      {actionState.showDetectPullRequest ? (
        <span className="ml-auto inline-flex">
          <DetectPullRequestAction
            disabledReason={actionState.detectPullRequestDisabledReason}
            isDetecting={actionState.isDetectingPullRequest}
            onDetect={onDetectPullRequest}
          />
        </span>
      ) : null}
    </div>
  );
}

import { AlertTriangle, FolderGit2, GitMerge, Loader2, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import {
  type TaskCloseMergeCheck,
  useMergeStatusDuringCheck,
} from "@openducktor/frontend-core/tasks/approval/use-task-approval-merge-check";
import {
  cleanupTargetLabel,
  TASK_CLOSE_COPY,
  taskCloseEffectLines,
  uncommittedFilesText,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import {
  type TaskCloseImpact,
  type TaskReadState,
  type TaskWorktreeImpact,
  useRemoveWorktreeSettingsRead,
} from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import type { TaskMergeStatusView } from "@openducktor/frontend-core/tasks/presentation/task-merge-status";
import { Button } from "@/components/ui/button";
import { SwitchCard } from "@/components/ui/switch-card";
import { cn } from "@/lib/utils";

type TaskCloseConfirmContentProps = {
  impact: TaskCloseImpact;
  /** Null while the default value loads. */
  removeWorktree: boolean | null;
  onRemoveWorktreeChange: (removeWorktree: boolean) => void;
  disabled: boolean;
  /** The approval modal can run a merge check for the workspace. */
  mergeCheck?: TaskCloseMergeCheck | undefined;
};

/** The merge status, the cleanup choice, and the effects of one task close. */
export function TaskCloseConfirmContent({
  impact,
  removeWorktree,
  onRemoveWorktreeChange,
  disabled,
  mergeCheck,
}: TaskCloseConfirmContentProps): ReactElement {
  return (
    <div className="grid gap-4 text-sm">
      {impact.mergeStatus ? (
        <TaskCloseMergeStatus status={impact.mergeStatus} mergeCheck={mergeCheck} />
      ) : null}

      <TaskCleanupCard
        impact={impact}
        removeWorktree={removeWorktree}
        onRemoveWorktreeChange={onRemoveWorktreeChange}
        disabled={disabled}
      />

      <div className="space-y-1 text-muted-foreground">
        {taskCloseEffectLines(impact).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      <TaskReadError read={impact} />
    </div>
  );
}

/** The cleanup choice of a close that merges, with the read error that blocks it. */
export function TaskCleanupChoice({
  impact,
  removeWorktree,
  onRemoveWorktreeChange,
  disabled,
}: {
  impact: TaskWorktreeImpact;
  removeWorktree: boolean | null;
  onRemoveWorktreeChange: (removeWorktree: boolean) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div className="grid gap-2 text-sm">
      <TaskCleanupCard
        impact={impact}
        removeWorktree={removeWorktree}
        onRemoveWorktreeChange={onRemoveWorktreeChange}
        disabled={disabled}
      />
      <TaskReadError read={impact} />
    </div>
  );
}

/** A failed read blocks its confirmation, so the confirmation shows the error and a retry. */
export function TaskReadError({ read }: { read: TaskReadState }): ReactElement | null {
  if (!read.error) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-destructive-muted">{read.error}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={read.isLoading}
        onClick={read.retry}
      >
        <RefreshCw data-icon="inline-start" />
        {TASK_CLOSE_COPY.retry}
      </Button>
    </div>
  );
}

/**
 * The cleanup choice with the worktrees and branches that it removes. The rows do not change with
 * the choice, so the card keeps its size. The Archive chat dialog uses the same card.
 */
function TaskCleanupCard({
  impact,
  removeWorktree,
  onRemoveWorktreeChange,
  disabled,
}: {
  impact: TaskWorktreeImpact;
  removeWorktree: boolean | null;
  onRemoveWorktreeChange: (removeWorktree: boolean) => void;
  disabled: boolean;
}): ReactElement {
  // The choice starts from the global setting, so a failed settings read blocks it.
  const settingsRead = useRemoveWorktreeSettingsRead(removeWorktree);
  return (
    <SwitchCard
      icon={FolderGit2}
      label={TASK_CLOSE_COPY.removeWorktreeLabel}
      checked={removeWorktree === true}
      onCheckedChange={onRemoveWorktreeChange}
      disabled={disabled || removeWorktree === null}
    >
      <TaskCleanupTargets impact={impact} removes={removeWorktree === true} />
      {settingsRead ? <TaskReadError read={settingsRead} /> : null}
    </SwitchCard>
  );
}

/** The worktrees, branches, and uncommitted files that a cleanup removes. */
export function TaskCleanupTargets({
  impact,
  removes,
}: {
  impact: TaskWorktreeImpact;
  removes: boolean;
}): ReactElement {
  const { worktreePaths, branchNames, uncommittedFileCount } = impact;
  if (worktreePaths.length === 0 && branchNames.length === 0) {
    return <p className="text-sm text-muted-foreground">{TASK_CLOSE_COPY.noCleanupTargets}</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-sm">
      {worktreePaths.length > 0 ? (
        <TaskCleanupTarget
          label={cleanupTargetLabel("worktree", worktreePaths.length)}
          values={worktreePaths}
        />
      ) : null}
      {branchNames.length > 0 ? (
        <TaskCleanupTarget
          label={cleanupTargetLabel("branch", branchNames.length)}
          values={branchNames}
        />
      ) : null}
      {uncommittedFileCount > 0 ? (
        <>
          <dt className="text-muted-foreground">{TASK_CLOSE_COPY.changesLabel}</dt>
          {/* Only the color changes with the choice, so the row keeps its size. */}
          <dd
            className={cn(
              "flex items-center gap-1.5",
              removes ? "text-warning-muted" : "text-foreground",
            )}
          >
            <AlertTriangle
              className={cn("size-3.5 shrink-0", removes ? "opacity-100" : "opacity-0")}
              aria-hidden="true"
            />
            {uncommittedFilesText(uncommittedFileCount)}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function TaskCleanupTarget({ label, values }: { label: string; values: string[] }): ReactElement {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="grid font-mono text-xs leading-5 text-foreground">
        {values.map((value) => (
          <span key={value} className="break-all">
            {value}
          </span>
        ))}
      </dd>
    </>
  );
}

function TaskCloseMergeStatus({
  status,
  mergeCheck,
}: {
  status: TaskMergeStatusView;
  mergeCheck: TaskCloseMergeCheck | undefined;
}): ReactElement {
  const { shown, isChecking, checkAgain } = useMergeStatusDuringCheck(status, mergeCheck);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border p-3",
        MERGE_STATUS_CLASS_NAME[shown.kind],
      )}
      data-testid="task-close-merge-status"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <GitMerge className="size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <p className="break-words font-medium">{shown.text}</p>
          {shown.detail ? <p className="text-xs opacity-80">{shown.detail}</p> : null}
          {mergeCheck?.error ? (
            <p className="text-xs text-destructive-muted">{mergeCheck.error}</p>
          ) : null}
        </div>
      </div>
      {mergeCheck ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={isChecking}
          aria-busy={isChecking}
          onClick={checkAgain}
        >
          {/* The label stays, so the button keeps its width while the check runs. */}
          {isChecking ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {TASK_CLOSE_COPY.checkAgain}
        </Button>
      ) : null}
    </div>
  );
}

const MERGE_STATUS_CLASS_NAME = {
  merged: "border-success-border bg-success-surface text-success-surface-foreground",
  not_merged: "border-warning-border bg-warning-surface text-warning-surface-foreground",
  not_checked: "border-border bg-muted/40 text-muted-foreground",
  failed: "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
} satisfies Record<TaskMergeStatusView["kind"], string>;

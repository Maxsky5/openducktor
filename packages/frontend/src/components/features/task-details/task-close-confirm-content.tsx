import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderGit2,
  GitMerge,
  Loader2,
  RefreshCw,
} from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const activity = taskCloseEffectLines(impact);
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

      <section className="flex flex-col gap-2.5" aria-label="After closing">
        <h3 className="text-xs font-medium text-muted-foreground">After closing</h3>
        <ul className="flex flex-col gap-2.5">
          {TASK_CLOSE_COPY.closeNotes.map((line) => (
            <li key={line} className="flex items-start gap-2.5 leading-5">
              <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
      {activity.length > 0 ? (
        <div className="flex flex-col gap-1 text-xs leading-5 text-muted-foreground">
          {activity.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

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

/** The cleanup choice, its loss warning, and details of the worktrees and branches. */
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
}): ReactElement | null {
  const { worktreePaths, branchNames, uncommittedFileCount } = impact;
  if (impact.error) return null;
  if (worktreePaths.length === 0 && branchNames.length === 0) {
    return <p className="text-sm text-muted-foreground">{TASK_CLOSE_COPY.noCleanupTargets}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {uncommittedFileCount > 0 ? (
        <p
          className={cn(
            "flex items-start gap-2 text-xs leading-5",
            removes ? "text-warning-muted" : "text-muted-foreground",
          )}
        >
          {removes ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : null}
          <span>
            <span>{uncommittedFilesText(uncommittedFileCount)}</span>
            {removes ? " will be lost." : " will be kept."}
          </span>
        </p>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">No uncommitted changes.</p>
      )}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="group -ml-2 h-7 gap-1.5">
            <ChevronDown
              className="transition-transform group-data-[state=open]:rotate-180"
              data-icon="inline-start"
            />
            Worktree details
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="grid grid-cols-1 gap-1 pt-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2">
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
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
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

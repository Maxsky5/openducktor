import type { PullRequest, TaskCard } from "@openducktor/contracts";
import { Check, CircleAlert } from "lucide-react";
import { memo, type ReactElement } from "react";
import { TaskCleanupChoice } from "@/components/features/task-details/task-close-confirm-content";
import { TaskReadsLoading } from "@/components/features/task-details/task-reads-loading";
import { formatActiveSessionStopMessage } from "@openducktor/frontend-core/tasks/details/task-cleanup-impact-model";
import {
  isCloseBlocked,
  useTaskCloseChoice,
  useTaskCloseImpact,
  useTaskCloseLoader,
} from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { GitConfirmationDialog } from "@/components/features/agents/agent-studio-git-panel/git-confirmation-dialog";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import {
  formatMergedAt,
  MERGED_PULL_REQUEST_CONFIRM_COPY as COPY,
} from "@openducktor/frontend-core/tasks/pull-requests/merged-pull-request-confirm-copy";
import type { CloseTaskOptions } from "@openducktor/frontend-core/types/task-close";

type MergedPullRequestConfirmDialogProps = {
  taskId: string;
  taskTitle: string | null;
  taskRemoveWorktreeOnClose: TaskCard["removeWorktreeOnClose"];
  pullRequest: PullRequest | null;
  isLinking: boolean;
  onCancel: () => void;
  onConfirm: (options: CloseTaskOptions) => void;
};

export const MergedPullRequestConfirmDialog = memo(function MergedPullRequestConfirmDialog({
  taskId,
  taskTitle,
  taskRemoveWorktreeOnClose,
  pullRequest,
  isLinking,
  onCancel,
  onConfirm,
}: MergedPullRequestConfirmDialogProps): ReactElement {
  // The page mounts one dialog for each pending link, so the choice applies to that link only.
  const { removeWorktree, onRemoveWorktreeChange } = useTaskCloseChoice(taskRemoveWorktreeOnClose);
  // The link stops the task terminals and live sessions, as a close does.
  const impact = useTaskCloseImpact({
    task: { id: taskId, title: taskTitle ?? "" },
    enabled: pullRequest != null,
  });
  const isPreparing = useTaskCloseLoader(impact);
  return (
    <GitConfirmationDialog
      open={pullRequest != null}
      onOpenChange={(open) => {
        if (isLinking) {
          return;
        }
        if (!open) {
          onCancel();
        }
      }}
      title={COPY.title}
      description={<>{COPY.description}</>}
      closeLabel={COPY.cancelLabel}
      closeDisabled={isLinking}
      onClose={onCancel}
      closeTestId="merged-pr-dialog-cancel-button"
      confirmLabel={COPY.confirmLabel}
      confirmPendingLabel={COPY.confirmPendingLabel}
      confirmPending={isLinking}
      confirmDisabled={isPreparing || isLinking || isCloseBlocked(impact, removeWorktree)}
      onConfirm={() => {
        if (removeWorktree !== null) onConfirm({ removeWorktree });
      }}
      confirmTestId="merged-pr-dialog-confirm-button"
      confirmIcon={Check}
      contentTestId="merged-pr-dialog"
    >
      <div className="grid gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{COPY.taskHeading}</p>
          {taskTitle ? (
            <p className="break-words font-medium text-foreground">{taskTitle}</p>
          ) : null}
          <p className="break-words font-mono text-sm text-muted-foreground">{taskId}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {COPY.pullRequestHeading}
              </p>
              {pullRequest ? <TaskPullRequestLink pullRequest={pullRequest} /> : null}
            </div>
            {pullRequest?.mergedAt ? (
              <div className="rounded-xl border border-input px-3 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {COPY.mergedAtHeading}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {formatMergedAt(pullRequest.mergedAt)}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {isPreparing ? (
          <TaskReadsLoading />
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-md border border-info-border bg-info-surface p-4 text-sm text-info-surface-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-info-muted" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="font-semibold">{COPY.nextStepsHeading}</p>
                <p className="leading-6">{COPY.nextSteps}</p>
                {/* A failed session read shows in the read error row, with a retry. */}
                {impact.activeSessionCount ? (
                  <p className="leading-6">
                    {formatActiveSessionStopMessage(impact.activeSessionCount, "close")}
                  </p>
                ) : null}
              </div>
            </div>

            <TaskCleanupChoice
              impact={impact}
              removeWorktree={removeWorktree}
              onRemoveWorktreeChange={onRemoveWorktreeChange}
              disabled={isLinking}
            />
          </>
        )}
      </div>
    </GitConfirmationDialog>
  );
});

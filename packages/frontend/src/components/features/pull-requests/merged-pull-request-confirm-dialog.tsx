import type { PullRequest } from "@openducktor/contracts";
import { Check, CircleAlert } from "lucide-react";
import { memo, type ReactElement } from "react";
import { GitConfirmationDialog } from "@/components/features/agents/agent-studio-git-panel/git-confirmation-dialog";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import {
  formatMergedAt,
  MERGED_PULL_REQUEST_CONFIRM_COPY as COPY,
} from "@openducktor/frontend-core/tasks/pull-requests/merged-pull-request-confirm-copy";

type MergedPullRequestConfirmDialogProps = {
  taskId: string;
  taskTitle: string | null;
  pullRequest: PullRequest | null;
  isLinking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export const MergedPullRequestConfirmDialog = memo(function MergedPullRequestConfirmDialog({
  taskId,
  taskTitle,
  pullRequest,
  isLinking,
  onCancel,
  onConfirm,
}: MergedPullRequestConfirmDialogProps): ReactElement {
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
      confirmDisabled={isLinking}
      onConfirm={onConfirm}
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

        <div className="flex items-start gap-3 rounded-md border border-info-border bg-info-surface p-4 text-sm text-info-surface-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-info-muted" aria-hidden="true" />
          <div className="space-y-1.5">
            <p className="font-semibold">{COPY.nextStepsHeading}</p>
            <p className="leading-6">{COPY.nextSteps}</p>
          </div>
        </div>
      </div>
    </GitConfirmationDialog>
  );
});

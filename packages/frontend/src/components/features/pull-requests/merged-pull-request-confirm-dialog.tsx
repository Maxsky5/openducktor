import type { PullRequest } from "@openducktor/contracts";
import { Check, CircleAlert } from "lucide-react";
import { memo, type ReactElement } from "react";
import { GitConfirmationDialog } from "@/components/features/agents/agent-studio-git-panel/git-confirmation-dialog";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";

type MergedPullRequestConfirmDialogProps = {
  pullRequest: PullRequest | null;
  isLinking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function formatMergedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export const MergedPullRequestConfirmDialog = memo(function MergedPullRequestConfirmDialog({
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
      title="Attach merged PR and finish task?"
      description={
        <>
          This branch already landed on GitHub. Linking the merged pull request will close the task
          cleanly and retire the builder worktree in one step.
        </>
      }
      closeLabel="Cancel"
      closeDisabled={isLinking}
      onClose={onCancel}
      closeTestId="merged-pr-dialog-cancel-button"
      confirmLabel="Link and mark done"
      confirmPendingLabel="Linking merged PR..."
      confirmPending={isLinking}
      confirmDisabled={isLinking}
      onConfirm={onConfirm}
      confirmTestId="merged-pr-dialog-confirm-button"
      confirmIcon={Check}
      contentTestId="merged-pr-dialog"
    >
      <div className="grid gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Pull Request
              </p>
              {pullRequest ? <TaskPullRequestLink pullRequest={pullRequest} /> : null}
            </div>
            {pullRequest?.mergedAt ? (
              <div className="rounded-xl border border-input px-3 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Merged At
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
            <p className="font-semibold">What happens next</p>
            <p className="leading-6">
              The task will be marked Done, then OpenDucktor will stop any builder dev servers and
              remove the builder worktree and local branch for this task.
            </p>
          </div>
        </div>
      </div>
    </GitConfirmationDialog>
  );
});

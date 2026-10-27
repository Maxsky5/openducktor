import { canonicalTargetBranch } from "@openducktor/frontend-core/lib/target-branch";
import {
  TASK_APPROVAL_COPY as COPY,
  directMergeCompletionButtonLabel,
  directMergeCompletionConfirmDisabled,
  directMergeCompletionStageDescription,
  getDirectMergeCompletionContextError,
  taskApprovalCompletionNextStepText,
  taskApprovalPublicationCommitLabel,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalCompletionModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type { TaskWorktreeImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { TaskCleanupChoice } from "@/components/features/task-details/task-close-confirm-content";
import { TaskReadsLoading } from "@/components/features/task-details/task-reads-loading";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  SECTION_LABEL_CLASS,
  STAGE_BODY_CLASS,
  STAGE_CONTENT_CLASS,
  TextWithCode,
} from "./task-approval-stage-controls";

/** The stage that publishes a recorded local merge and closes the task. */
export function TaskApprovalCompletionStage({
  model,
  impact,
  isPreparing,
}: {
  model: TaskApprovalCompletionModalModel;
  /** The completion closes the task, so it names the worktree that stays or goes first. */
  impact: TaskWorktreeImpact;
  /** A read of the modal still runs, so the stage shows the loader. */
  isPreparing: boolean;
}): ReactElement {
  const completionContextError = getDirectMergeCompletionContextError(model);
  const completionActionDisabled = directMergeCompletionConfirmDisabled(model, impact, isPreparing);

  return (
    <>
      <DialogBody className={STAGE_BODY_CLASS}>
        {isPreparing ? (
          <TaskReadsLoading className="h-full min-h-56 px-6 py-6 sm:px-8" />
        ) : (
          <TaskApprovalCompletionContent
            model={model}
            completionContextError={completionContextError}
            impact={impact}
          />
        )}
      </DialogBody>

      <DialogFooter className="mt-0 flex-col gap-3 border-t border-border/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-sm text-muted-foreground">
          {directMergeCompletionStageDescription(model)}
        </p>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={model.isSubmitting}
            onClick={model.onSkipDirectMergeCompletion}
          >
            {COPY.finishLater}
          </Button>
          <Button
            type="button"
            disabled={completionActionDisabled}
            onClick={model.onCompleteDirectMerge}
          >
            {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {directMergeCompletionButtonLabel(model)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function TaskApprovalCompletionContent({
  model,
  completionContextError,
  impact,
}: {
  model: TaskApprovalCompletionModalModel;
  completionContextError: string | null;
  impact: TaskWorktreeImpact;
}): ReactElement {
  const hasPublishTarget = model.publishTarget !== null;
  const completionErrorMessage = completionContextError ?? model.errorMessage;
  const localBranchName = model.targetBranch?.branch ?? "";
  const publishTargetLabel = model.publishTarget ? canonicalTargetBranch(model.publishTarget) : "";

  return (
    <div className={STAGE_CONTENT_CLASS}>
      {completionErrorMessage ? (
        <div className="grid gap-1 rounded-lg border border-destructive-border bg-destructive-surface p-3 text-sm text-destructive-surface-foreground">
          <p className="font-semibold">{COPY.completionFailedTitle}</p>
          <p className="text-destructive-muted">{completionErrorMessage}</p>
        </div>
      ) : null}

      {completionContextError ? null : (
        <>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">{COPY.nextStepTitle}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                <TextWithCode text={taskApprovalCompletionNextStepText(model)} />
              </p>
            </div>

            <div
              className={cn(
                "mt-4 grid gap-3",
                hasPublishTarget &&
                  "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center",
              )}
            >
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className={SECTION_LABEL_CLASS}>{COPY.localBranchLabel}</p>
                <p className="mt-2 font-mono text-sm text-foreground">{localBranchName}</p>
              </div>

              {hasPublishTarget ? (
                <>
                  <div className="hidden justify-center md:flex">
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>

                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className={SECTION_LABEL_CLASS}>{COPY.remoteToUpdateLabel}</p>
                    <p className="mt-2 font-mono text-sm text-foreground">{publishTargetLabel}</p>
                    {model.publicationPreview ? (
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <p>
                          {taskApprovalPublicationCommitLabel(model.publicationPreview.sourceOid)}
                        </p>
                        {model.publicationPreview.destinations.map((destination) => (
                          <p key={destination.identity} className="break-all">
                            {destination.label}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <TaskCleanupChoice
            impact={impact}
            removeWorktree={model.removeWorktree}
            onRemoveWorktreeChange={model.onRemoveWorktreeChange}
            disabled={model.isSubmitting}
          />
        </>
      )}
    </div>
  );
}

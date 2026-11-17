import { CircleCheckBig, LoaderCircle, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import {
  TASK_APPROVAL_COPY as COPY,
  missingWorktreeConfirmDisabled,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalMissingWorktreeModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type { TaskCloseMergeCheck } from "@openducktor/frontend-core/tasks/approval/use-task-approval-merge-check";
import { taskCloseConfirmLabel } from "@openducktor/frontend-core/tasks/details/task-close-copy";
import type { TaskCloseImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { TaskCloseConfirmContent } from "@/components/features/task-details/task-close-confirm-content";
import {
  STAGE_ACTIONS_FOOTER_CLASS,
  STAGE_BODY_CLASS,
  STAGE_CONTENT_CLASS,
} from "./task-approval-stage-controls";

/**
 * The recovery stage when the task worktree is missing. It offers Close Task, and the workflow
 * action that resets the worktree when the workflow has one.
 */
export function TaskApprovalMissingWorktreeStage({
  model,
  impact,
  isPreparing,
  mergeCheck,
}: {
  model: TaskApprovalMissingWorktreeModalModel;
  impact: TaskCloseImpact;
  /** A read of the modal still runs, so the stage shows the loader. */
  isPreparing: boolean;
  mergeCheck: TaskCloseMergeCheck | undefined;
}): ReactElement {
  return (
    <>
      <DialogBody className={STAGE_BODY_CLASS}>
        <div className={STAGE_CONTENT_CLASS}>
          {model.errorMessage ? (
            <div className="grid gap-1 rounded-lg border border-destructive-border bg-destructive-surface p-3 text-sm text-destructive-surface-foreground">
              <p className="font-semibold">{COPY.recoveryFailedTitle}</p>
              <p className="text-destructive-muted">{model.errorMessage}</p>
            </div>
          ) : null}
          <TaskCloseConfirmContent
            impact={impact}
            removeWorktree={model.removeWorktree}
            onRemoveWorktreeChange={model.onRemoveWorktreeChange}
            disabled={model.isSubmitting}
            mergeCheck={mergeCheck}
          />
        </div>
      </DialogBody>

      <DialogFooter className={STAGE_ACTIONS_FOOTER_CLASS}>
        <Button
          type="button"
          variant="outline"
          disabled={model.isSubmitting}
          onClick={() => model.onOpenChange(false)}
        >
          {COPY.cancel}
        </Button>
        <div className="flex w-full flex-col-reverse gap-2 [&>button]:w-full sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:[&>button]:w-auto">
          {model.resetLabel ? (
            <Button
              type="button"
              variant="destructive"
              disabled={model.isSubmitting}
              onClick={model.onResetMissingWorktree}
            >
              <RotateCcw data-icon="inline-start" />
              {model.resetLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="warning"
            disabled={missingWorktreeConfirmDisabled(model, impact, isPreparing)}
            onClick={model.onCloseMissingWorktree}
          >
            {model.isSubmitting ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <CircleCheckBig data-icon="inline-start" />
            )}
            {taskCloseConfirmLabel(model.isSubmitting)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

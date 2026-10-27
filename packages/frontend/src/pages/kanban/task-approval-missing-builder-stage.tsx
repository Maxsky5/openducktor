import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import {
  TASK_APPROVAL_COPY as COPY,
  missingBuilderWorktreeConfirmDisabled,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalMissingBuilderWorktreeModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type { TaskCloseMergeCheck } from "@openducktor/frontend-core/tasks/approval/use-task-approval-merge-check";
import { taskCloseConfirmLabel } from "@openducktor/frontend-core/tasks/details/task-close-copy";
import type { TaskCloseImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { TaskReadsLoading } from "@/components/features/task-details/task-reads-loading";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { TaskCloseConfirmContent } from "@/components/features/task-details/task-close-confirm-content";
import {
  STAGE_ACTIONS_FOOTER_CLASS,
  STAGE_BODY_CLASS,
  STAGE_CONTENT_CLASS,
} from "./task-approval-stage-controls";

/** The recovery stage when the builder worktree is missing. It offers Close Task. */
export function TaskApprovalMissingBuilderWorktreeStage({
  model,
  impact,
  isPreparing,
  mergeCheck,
}: {
  model: TaskApprovalMissingBuilderWorktreeModalModel;
  impact: TaskCloseImpact;
  /** A read of the modal still runs, so the stage shows the loader. */
  isPreparing: boolean;
  mergeCheck: TaskCloseMergeCheck | undefined;
}): ReactElement {
  return (
    <>
      <DialogBody className={STAGE_BODY_CLASS}>
        {isPreparing ? (
          <TaskReadsLoading className="h-full min-h-56 px-6 py-6 sm:px-8" />
        ) : (
          // The header names the missing worktree and the two next steps.
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
        )}
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
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={model.isSubmitting}
            onClick={model.onResetMissingBuilderWorktree}
          >
            {COPY.resetImplementation}
          </Button>
          <Button
            type="button"
            variant="warning"
            disabled={missingBuilderWorktreeConfirmDisabled(model, impact, isPreparing)}
            onClick={model.onCloseMissingBuilderWorktree}
          >
            {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {taskCloseConfirmLabel(model.isSubmitting)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

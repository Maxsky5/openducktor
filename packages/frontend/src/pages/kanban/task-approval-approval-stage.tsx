import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import {
  getTaskApprovalSubmitState,
  TASK_APPROVAL_COPY as COPY,
  taskApprovalModeOptions,
  taskApprovalPullRequestUnavailableMessage,
  taskApprovalUncommittedChangesMessage,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type { TaskCloseMergeCheck } from "@openducktor/frontend-core/tasks/approval/use-task-approval-merge-check";
import type { TaskApprovalImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { TaskReadsLoading } from "@/components/features/task-details/task-reads-loading";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TaskCloseConfirmContent } from "@/components/features/task-details/task-close-confirm-content";
import { TaskApprovalDirectMergeSection } from "./task-approval-direct-merge-section";
import { TaskApprovalPullRequestSection } from "./task-approval-pull-request-section";
import {
  SECTION_LABEL_CLASS,
  SegmentedTabs,
  STAGE_ACTIONS_FOOTER_CLASS,
  STAGE_BODY_CLASS,
  STAGE_CONTENT_CLASS,
} from "./task-approval-stage-controls";

/** The approval stage: Direct Merge, Pull Request, or Close Task, with its confirmation. */
export function TaskApprovalApprovalStage({
  model,
  impact,
  isPreparing,
  mergeCheck,
}: {
  model: TaskApprovalApprovalModalModel;
  impact: TaskApprovalImpact;
  /** A read of the modal still runs, so the stage shows the loader. */
  isPreparing: boolean;
  mergeCheck: TaskCloseMergeCheck | undefined;
}): ReactElement {
  const submit = getTaskApprovalSubmitState(model, impact, isPreparing);

  return (
    <>
      <DialogBody className={STAGE_BODY_CLASS}>
        {isPreparing ? (
          <TaskReadsLoading className="h-full min-h-56 px-6 py-6 sm:px-8" />
        ) : (
          <TaskApprovalApprovalContent
            model={model}
            impact={impact}
            mergeCheck={mergeCheck}
            showSquashCommitMessageValidationError={submit.showSquashCommitMessageValidationError}
          />
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
        <Button
          type="button"
          variant={model.mode === "close_task" ? "warning" : "default"}
          disabled={submit.confirmDisabled}
          onClick={model.onConfirm}
        >
          {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {submit.confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function TaskApprovalApprovalContent({
  model,
  impact,
  mergeCheck,
  showSquashCommitMessageValidationError,
}: {
  model: TaskApprovalApprovalModalModel;
  impact: TaskApprovalImpact;
  mergeCheck: TaskCloseMergeCheck | undefined;
  showSquashCommitMessageValidationError: boolean;
}): ReactElement {
  return (
    <div className={STAGE_CONTENT_CLASS}>
      {model.errorMessage ? (
        <div className="grid gap-1 rounded-lg border border-destructive-border bg-destructive-surface p-3 text-sm text-destructive-surface-foreground">
          <p className="font-semibold">{COPY.approvalFailedTitle}</p>
          <p className="text-destructive-muted">{model.errorMessage}</p>
        </div>
      ) : null}

      {model.approvalContextError ? (
        <div className="grid gap-1 rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
          <p className="font-semibold">{COPY.approvalContextErrorTitle}</p>
          <p>{model.approvalContextError}</p>
          <p>{COPY.approvalContextErrorNote}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <Label className={SECTION_LABEL_CLASS}>{COPY.approvalActionLabel}</Label>
        <SegmentedTabs
          ariaLabel={COPY.approvalActionAccessibilityLabel}
          value={model.mode}
          options={taskApprovalModeOptions(model)}
          disabled={model.isSubmitting}
          onChange={model.onModeChange}
        />
        {!model.pullRequestAvailable && model.pullRequestUnavailableReason ? (
          <p className="text-sm text-muted-foreground">
            {taskApprovalPullRequestUnavailableMessage(model.pullRequestUnavailableReason)}
          </p>
        ) : null}
      </div>

      {/* A close does not need a clean worktree. Only a merge does. */}
      {model.hasUncommittedChanges && model.mode !== "close_task" ? (
        <div className="grid gap-1 rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
          <p className="font-semibold">{COPY.uncommittedChangesTitle}</p>
          <p>{taskApprovalUncommittedChangesMessage(model.uncommittedFileCount)}</p>
        </div>
      ) : null}

      {model.mode === "direct_merge" ? (
        <TaskApprovalDirectMergeSection
          model={model}
          showSquashCommitMessageValidationError={showSquashCommitMessageValidationError}
          impact={impact.worktree}
        />
      ) : null}
      {model.mode === "pull_request" ? <TaskApprovalPullRequestSection model={model} /> : null}
      {model.mode === "close_task" ? (
        <TaskCloseConfirmContent
          impact={impact.close}
          removeWorktree={model.removeWorktree}
          onRemoveWorktreeChange={model.onRemoveWorktreeChange}
          disabled={model.isSubmitting}
          mergeCheck={mergeCheck}
        />
      ) : null}
    </div>
  );
}

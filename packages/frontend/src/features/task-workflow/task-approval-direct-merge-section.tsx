import {
  TASK_APPROVAL_COPY as COPY,
  TASK_APPROVAL_MERGE_METHOD_OPTIONS,
  taskApprovalSquashCommitHint,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type { TaskWorktreeImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import type { ReactElement } from "react";
import { TaskCleanupChoice } from "@/components/features/task-details/task-close-confirm-content";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OptionCard, SECTION_LABEL_CLASS, TextWithCode } from "./task-approval-stage-controls";

export function TaskApprovalDirectMergeSection({
  model,
  showSquashCommitMessageValidationError,
  impact,
}: {
  model: TaskApprovalApprovalModalModel;
  showSquashCommitMessageValidationError: boolean;
  impact: TaskWorktreeImpact;
}): ReactElement {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className={SECTION_LABEL_CLASS}>{COPY.mergeMethodLabel}</Label>
        <div className="grid gap-3 md:grid-cols-3">
          {TASK_APPROVAL_MERGE_METHOD_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              value={option.value}
              selectedValue={model.mergeMethod}
              label={option.label}
              description={option.description}
              disabled={model.isSubmitting}
              onSelect={model.onMergeMethodChange}
            />
          ))}
        </div>
      </div>

      {model.mergeMethod === "squash" ? (
        <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
          <Label htmlFor="task-approval-squash-commit-message">
            {COPY.squashCommitMessageLabel}
          </Label>
          <Textarea
            id="task-approval-squash-commit-message"
            className="min-h-28"
            placeholder={COPY.squashCommitMessagePlaceholder}
            value={model.squashCommitMessage}
            disabled={model.isSubmitting}
            onChange={(event) => model.onSquashCommitMessageChange(event.currentTarget.value)}
          />
          <p className="text-sm text-muted-foreground">
            <TextWithCode text={taskApprovalSquashCommitHint(model.targetBranch)} />
          </p>
          {showSquashCommitMessageValidationError ? (
            <p className="text-sm text-destructive">{COPY.squashCommitMessageRequired}</p>
          ) : null}
        </div>
      ) : null}

      <TaskCleanupChoice
        impact={impact}
        removeWorktree={model.removeWorktree}
        onRemoveWorktreeChange={model.onRemoveWorktreeChange}
        disabled={model.isSubmitting}
      />
    </div>
  );
}

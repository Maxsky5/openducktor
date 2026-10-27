import type { ReactElement } from "react";
import type { TaskApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { useTaskApprovalReads } from "@openducktor/frontend-core/tasks/approval/use-task-approval-reads";
import { TaskApprovalApprovalStage } from "./task-approval-approval-stage";
import { TaskApprovalCompletionStage } from "./task-approval-completion-stage";
import { TaskApprovalMissingBuilderWorktreeStage } from "./task-approval-missing-builder-stage";

/** The approval modal content, with one loader until the reads of the approval end. */
export function TaskApprovalModalPanel({ model }: { model: TaskApprovalModalModel }): ReactElement {
  const { impact, isPreparing, mergeCheck } = useTaskApprovalReads(model);

  return (
    <>
      {model.stage === "approval" ? (
        <TaskApprovalApprovalStage
          model={model}
          impact={impact}
          isPreparing={isPreparing}
          mergeCheck={mergeCheck}
        />
      ) : null}
      {model.stage === "missing_builder_worktree" ? (
        <TaskApprovalMissingBuilderWorktreeStage
          model={model}
          impact={impact.close}
          isPreparing={isPreparing}
          mergeCheck={mergeCheck}
        />
      ) : null}
      {model.stage === "complete_direct_merge" ? (
        <TaskApprovalCompletionStage
          model={model}
          impact={impact.worktree}
          isPreparing={isPreparing}
        />
      ) : null}
    </>
  );
}

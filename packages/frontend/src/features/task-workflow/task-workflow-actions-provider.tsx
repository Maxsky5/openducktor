import { type PropsWithChildren, type ReactElement } from "react";
import { SessionStartModal } from "@/components/features/agents/session-start-modal";
import { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
import { GitConflictDialog } from "@/features/git-conflict-resolution";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { TaskApprovalModal } from "@/pages/kanban/task-approval-modal";
import { TaskResetImplementationModal } from "@/pages/kanban/task-reset-implementation-modal";
import { TaskWorkflowActionsContext } from "./task-workflow-actions-context";
import { useTaskWorkflowActionsController } from "./use-task-workflow-actions-controller";

export function TaskWorkflowActionsProvider({ children }: PropsWithChildren): ReactElement {
  const controller = useTaskWorkflowActionsController();

  return (
    <TaskWorkflowActionsContext.Provider value={controller.actions}>
      {children}
      <TaskCreateModal {...controller.composer} />
      <HumanReviewFeedbackModal model={controller.humanReviewFeedbackModal} />
      {controller.sessionStartModal ? (
        <SessionStartModal model={controller.sessionStartModal} />
      ) : null}
      <TaskApprovalModal model={controller.taskApprovalModal} />
      <TaskResetImplementationModal model={controller.resetImplementationModal} />
      {controller.taskGitConflictDialog && controller.gitConflictActions ? (
        <GitConflictDialog
          conflict={controller.taskGitConflictDialog.conflict}
          open={controller.taskGitConflictDialog.open}
          onOpenChange={controller.taskGitConflictDialog.onOpenChange}
          actions={controller.gitConflictActions}
          testId="task-workflow-git-conflict-modal"
        />
      ) : null}
    </TaskWorkflowActionsContext.Provider>
  );
}

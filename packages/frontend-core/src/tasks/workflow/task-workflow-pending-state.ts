import type { TaskApprovalModalModel } from "../approval/task-approval-types";
import type { WorkflowPendingState } from "../board/kanban-task-footer";

/** The task whose approval loads or submits, or null. */
export function getApprovingTaskId(modal: TaskApprovalModalModel | null): string | null {
  return modal && (modal.isSubmitting || (modal.stage === "approval" && modal.isLoading))
    ? modal.taskId
    : null;
}

/** The workflow actions that run now, so task cards can show their progress. */
export const buildWorkflowPendingState = ({
  isSessionStarting,
  taskApprovalModal,
  humanReviewFeedbackModal,
  resetImplementationModal,
}: {
  isSessionStarting: boolean;
  taskApprovalModal: TaskApprovalModalModel | null;
  humanReviewFeedbackModal: { taskId: string; isSubmitting: boolean } | null;
  resetImplementationModal: { taskId: string; isSubmitting: boolean } | null;
}): WorkflowPendingState => ({
  isSessionStarting,
  approvingTaskId: getApprovingTaskId(taskApprovalModal),
  requestingChangesTaskId: humanReviewFeedbackModal?.isSubmitting
    ? humanReviewFeedbackModal.taskId
    : null,
  resettingImplementationTaskId: resetImplementationModal?.isSubmitting
    ? resetImplementationModal.taskId
    : null,
});

import { type ReactElement, useCallback, useRef } from "react";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import {
  createGitConflictActionsModel,
  GitConflictDialog,
} from "@/features/git-conflict-resolution";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { KanbanSessionStartModal } from "./kanban-session-start-modal";
import { TaskApprovalModal } from "./task-approval-modal";
import { TaskResetImplementationModal } from "./task-reset-implementation-modal";
import { useKanbanPageModels } from "./use-kanban-page-models";

export function KanbanPage(): ReactElement {
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const handleOpenDetails = useCallback((taskId: string): void => {
    taskDetailsSheetRef.current?.openTask(taskId);
  }, []);
  const handleCloseDetails = useCallback((): void => {
    taskDetailsSheetRef.current?.close();
  }, []);
  const models = useKanbanPageModels({
    onOpenDetails: handleOpenDetails,
    onCloseDetails: handleCloseDetails,
  });
  const taskGitConflictActions = models.taskGitConflictDialog?.conflict
    ? createGitConflictActionsModel({
        operation: models.taskGitConflictDialog.conflict.operation,
        isHandlingConflict: models.taskGitConflictDialog.isHandlingConflict,
        conflictAction: models.taskGitConflictDialog.conflictAction,
        onAbort: models.taskGitConflictDialog.onAbort,
        onAskBuilder: models.taskGitConflictDialog.onAskBuilder,
      })
    : null;

  return (
    <div className="flex h-full min-h-full min-w-0 flex-col gap-4 py-4 pl-4">
      <KanbanPageHeader model={models.header} />
      <KanbanPageContent model={models.content} />
      <TaskCreateModal {...models.taskComposer} />
      {models.mergedPullRequestModal ? (
        <MergedPullRequestConfirmDialog
          pullRequest={models.mergedPullRequestModal.pullRequest}
          isLinking={models.mergedPullRequestModal.isLinking}
          onCancel={models.mergedPullRequestModal.onCancel}
          onConfirm={models.mergedPullRequestModal.onConfirm}
        />
      ) : null}
      <TaskDetailsSheetController ref={taskDetailsSheetRef} {...models.taskDetailsController} />
      <HumanReviewFeedbackModal model={models.humanReviewFeedbackModal} />
      <TaskApprovalModal model={models.taskApprovalModal} />
      <TaskResetImplementationModal model={models.resetImplementationModal} />
      {models.taskGitConflictDialog && taskGitConflictActions ? (
        <GitConflictDialog
          conflict={models.taskGitConflictDialog.conflict}
          open={models.taskGitConflictDialog.open}
          onOpenChange={models.taskGitConflictDialog.onOpenChange}
          actions={taskGitConflictActions}
          testId="kanban-task-git-conflict-modal"
        />
      ) : null}
      <KanbanSessionStartModal model={models.sessionStartModal} />
    </div>
  );
}

import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { useKanbanPageModels } from "./use-kanban-page-models";

export function KanbanPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const actions = useRequiredTaskWorkflowActions();
  const handleOpenDetails = useCallback((taskId: string): void => {
    taskDetailsSheetRef.current?.openTask(taskId);
  }, []);
  const models = useKanbanPageModels({
    onOpenDetails: handleOpenDetails,
    actions,
  });
  const requestedTaskId = searchParams.get("task");
  useEffect(() => {
    if (!requestedTaskId) return;
    handleOpenDetails(requestedTaskId);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
  }, [handleOpenDetails, requestedTaskId, searchParams, setSearchParams]);

  return (
    <div className="flex h-full min-h-full min-w-0 flex-col gap-4 py-4 pl-4">
      <KanbanPageHeader model={models.header} />
      <KanbanPageContent model={models.content} />
      {models.mergedPullRequestModal ? (
        <MergedPullRequestConfirmDialog
          pullRequest={models.mergedPullRequestModal.pullRequest}
          isLinking={models.mergedPullRequestModal.isLinking}
          onCancel={models.mergedPullRequestModal.onCancel}
          onConfirm={models.mergedPullRequestModal.onConfirm}
        />
      ) : null}
      <TaskDetailsSheetController ref={taskDetailsSheetRef} {...models.taskDetailsController} />
    </div>
  );
}

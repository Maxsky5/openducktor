import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { IssueImportDialog } from "./issue-import-dialog";
import { useKanbanPageModels } from "./use-kanban-page-models";

export function KanbanPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const actions = useRequiredTaskWorkflowActions();
  const [importOpen, setImportOpen] = useState(false);
  const handleOpenDetails = useCallback((taskId: string): void => {
    taskDetailsSheetRef.current?.openTask(taskId);
  }, []);
  const models = useKanbanPageModels({
    onOpenDetails: handleOpenDetails,
    onImportIssues: () => setImportOpen(true),
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
      {models.header.importProviderContext && models.taskDetailsController.activeWorkspace ? (
        <IssueImportDialog
          key={JSON.stringify([
            models.taskDetailsController.activeWorkspace.workspaceId,
            models.header.importProviderContext.config.id,
            models.header.importProviderContext.config.repository,
            models.header.importProviderContext.config.settings?.areaPath,
          ])}
          open={importOpen}
          onOpenChange={setImportOpen}
          repoPath={models.taskDetailsController.activeWorkspace.repoPath}
          provider={models.header.importProviderContext}
          onImported={models.header.onRefreshTasks}
        />
      ) : null}
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

import { type ReactElement, useEffect } from "react";
import { useSearchParams } from "react-router";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { KANBAN_TASK_QUERY_KEYS } from "./kanban-task-link";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { useKanbanPageModels } from "./use-kanban-page-models";

export function KanbanPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const actions = useRequiredTaskWorkflowActions();
  const { onOpenTaskDetails } = actions;
  const models = useKanbanPageModels({
    onOpenDetails: onOpenTaskDetails,
    actions,
  });
  const requestedTaskId = searchParams.get(KANBAN_TASK_QUERY_KEYS.task);
  useEffect(() => {
    if (!requestedTaskId) return;
    onOpenTaskDetails(requestedTaskId);
    const next = new URLSearchParams(searchParams);
    next.delete(KANBAN_TASK_QUERY_KEYS.task);
    setSearchParams(next, { replace: true });
  }, [onOpenTaskDetails, requestedTaskId, searchParams, setSearchParams]);

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
    </div>
  );
}

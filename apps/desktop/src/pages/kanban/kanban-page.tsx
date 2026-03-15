import { lazy, type ReactElement, Suspense, useCallback, useState } from "react";
import type { TaskCreateModalProps } from "@/components/features/task-create/task-create-modal";
import type { TaskDetailsSheetControllerProps } from "@/components/features/task-details/task-details-sheet-controller";
import { HumanReviewFeedbackModal } from "./human-review-feedback-modal";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { KanbanSessionStartModal } from "./kanban-session-start-modal";
import { TaskApprovalModal } from "./task-approval-modal";
import { useKanbanPageModels } from "./use-kanban-page-models";

const TaskCreateModal = lazy(async () => {
  const module = await import("@/components/features/task-create/task-create-modal");
  return { default: module.TaskCreateModal };
});

const TaskDetailsSheetController = lazy(async () => {
  const module = await import("@/components/features/task-details/task-details-sheet-controller");
  return { default: module.TaskDetailsSheetController };
});

export function KanbanPage(): ReactElement {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const handleOpenDetails = useCallback((taskId: string): void => {
    setActiveTaskId(taskId);
  }, []);
  const models = useKanbanPageModels({
    onOpenDetails: handleOpenDetails,
  });
  const shouldRenderTaskCreateModal = models.taskComposer.open;
  const shouldRenderTaskDetails = activeTaskId !== null;

  return (
    <div className="flex h-full min-h-full min-w-0 flex-col gap-4 py-4 pl-4">
      <KanbanPageHeader model={models.header} />
      <KanbanPageContent model={models.content} />
      {shouldRenderTaskCreateModal ? (
        <Suspense fallback={null}>
          <TaskCreateModal {...(models.taskComposer as TaskCreateModalProps)} />
        </Suspense>
      ) : null}
      {shouldRenderTaskDetails ? (
        <Suspense fallback={null}>
          <TaskDetailsSheetController
            {...(models.taskDetailsController as TaskDetailsSheetControllerProps)}
            activeTaskId={activeTaskId}
            onActiveTaskIdChange={setActiveTaskId}
          />
        </Suspense>
      ) : null}
      <HumanReviewFeedbackModal model={models.humanReviewFeedbackModal} />
      <TaskApprovalModal model={models.taskApprovalModal} />
      <KanbanSessionStartModal model={models.sessionStartModal} />
    </div>
  );
}

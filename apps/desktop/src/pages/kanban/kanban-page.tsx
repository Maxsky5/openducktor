import { type ReactElement, useCallback, useRef } from "react";
import { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { KanbanSessionStartModal } from "./kanban-session-start-modal";
import { useKanbanPageModels } from "./use-kanban-page-models";

export function KanbanPage(): ReactElement {
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const handleOpenDetails = useCallback((taskId: string): void => {
    taskDetailsSheetRef.current?.openTask(taskId);
  }, []);
  const models = useKanbanPageModels({
    onOpenDetails: handleOpenDetails,
  });

  return (
    <div className="flex h-full min-h-full min-w-0 flex-col gap-4 py-4 pl-4">
      <KanbanPageHeader model={models.header} />
      <KanbanPageContent model={models.content} />
      <TaskCreateModal {...models.taskComposer} />
      <TaskDetailsSheetController ref={taskDetailsSheetRef} {...models.taskDetailsController} />
      <KanbanSessionStartModal model={models.sessionStartModal} />
    </div>
  );
}

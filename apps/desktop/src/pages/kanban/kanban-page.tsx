import type { ReactElement } from "react";
import { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
import { TaskDetailsSheet } from "@/components/features/task-details/task-details-sheet";
import { KanbanPageContent } from "./kanban-page-content";
import { KanbanPageHeader } from "./kanban-page-header";
import { KanbanSessionStartModal } from "./kanban-session-start-modal";
import { useKanbanPageModels } from "./use-kanban-page-models";

export function KanbanPage(): ReactElement {
  const models = useKanbanPageModels();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden py-4 pl-4">
      <KanbanPageHeader model={models.header} />
      <KanbanPageContent model={models.content} />
      <TaskCreateModal {...models.taskComposer} />
      <TaskDetailsSheet {...models.detailsSheet} />
      <KanbanSessionStartModal model={models.sessionStartModal} />
    </div>
  );
}

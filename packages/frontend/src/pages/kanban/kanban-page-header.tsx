import { Loader2, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { TaskCardViewControl } from "@/components/features/kanban/task-card-view-control";
import { Button } from "@/components/ui/button";
import { KanbanBoardFilterBar } from "./kanban-board-filter-bar";
import type { KanbanPageHeaderModel } from "./kanban-page-model-types";

type KanbanPageHeaderProps = {
  model: KanbanPageHeaderModel;
};

export function KanbanPageHeader({ model }: KanbanPageHeaderProps): ReactElement {
  return (
    <div className="electron-titlebar-safe-area flex flex-wrap items-start justify-between gap-3 pr-4">
      <h2 className="sr-only">Kanban Board</h2>
      <KanbanBoardFilterBar filter={model.filter} />
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2" aria-busy={model.isTaskCardViewPending}>
          <TaskCardViewControl
            size="sm"
            value={model.taskCardView}
            disabled={model.isTaskCardViewPending}
            onValueChange={model.onTaskCardViewChange}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={model.isLoadingTasks || model.isSwitchingWorkspace}
          onClick={model.onRefreshTasks}
        >
          {model.isLoadingTasks ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="size-3.5" />
          )}
          {model.isLoadingTasks ? "Refreshing..." : "Refresh Tasks"}
        </Button>
      </div>
    </div>
  );
}

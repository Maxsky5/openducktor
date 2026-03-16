import { Loader2, Plus, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useChecksState, useWorkspaceState } from "@/state";
import { isKanbanTaskCreationDisabled } from "./kanban-page-header-model";
import type { KanbanPageHeaderModel } from "./kanban-page-model-types";

type KanbanPageHeaderProps = {
  model: KanbanPageHeaderModel;
};

export function KanbanPageHeader({ model }: KanbanPageHeaderProps): ReactElement {
  const { activeRepo } = useWorkspaceState();
  const { beadsCheck } = useChecksState();
  const isCreateTaskDisabled = isKanbanTaskCreationDisabled(activeRepo, beadsCheck);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pl-2 pr-4">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Kanban Board</h2>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="default"
          className="h-10"
          disabled={isCreateTaskDisabled}
          onClick={model.onCreateTask}
        >
          <Plus className="size-3.5" />
          Create Task
        </Button>
        <Button
          type="button"
          size="default"
          variant="outline"
          className="h-10"
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

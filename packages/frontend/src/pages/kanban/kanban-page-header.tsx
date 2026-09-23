import { ChevronDown, Loader2, Plus, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { TaskCardViewControl } from "@/components/features/kanban/task-card-view-control";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useChecksState, useWorkspaceState } from "@/state";
import { isKanbanTaskCreationDisabled } from "./kanban-page-header-model";
import type { KanbanPageHeaderModel } from "./kanban-page-model-types";

type KanbanPageHeaderProps = {
  model: KanbanPageHeaderModel;
};

export function KanbanPageHeader({ model }: KanbanPageHeaderProps): ReactElement {
  const { activeWorkspace } = useWorkspaceState();
  const { taskStoreCheck } = useChecksState();
  const isCreateTaskDisabled = isKanbanTaskCreationDisabled(activeWorkspace, taskStoreCheck);
  const provider = model.importProviderContext;
  const canImport =
    !isCreateTaskDisabled &&
    provider?.config.enabled === true &&
    provider.config.repository !== undefined &&
    provider.descriptor.capabilities.issueAccess !== undefined;

  return (
    <div className="electron-titlebar-safe-area flex flex-wrap items-center justify-between gap-3 pl-2 pr-4">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Kanban Board</h2>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2" aria-busy={model.isTaskCardViewPending}>
          <TaskCardViewControl
            value={model.taskCardView}
            disabled={model.isTaskCardViewPending}
            onValueChange={model.onTaskCardViewChange}
          />
        </div>
        <div className="flex items-center">
          <Button
            type="button"
            size="default"
            className={canImport ? "h-10 rounded-r-none" : "h-10"}
            disabled={isCreateTaskDisabled}
            onClick={model.onCreateTask}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            New task
          </Button>
          {canImport ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="default"
                  aria-label="More task actions"
                  className="h-10 rounded-l-none border-l border-primary-foreground/30 px-2"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left font-normal"
                  onClick={model.onImportIssues}
                >
                  Import from{" "}
                  {provider.config.id === "github" ? "GitHub Issues" : "Azure DevOps work items"}
                </Button>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
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

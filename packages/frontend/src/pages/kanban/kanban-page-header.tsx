import { Loader2, Plus, RefreshCcw, Rows2, Rows3 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChecksState, useWorkspaceState } from "@/state";
import { isKanbanTaskCreationDisabled } from "./kanban-page-header-model";
import type { KanbanPageHeaderModel } from "./kanban-page-model-types";

type KanbanPageHeaderProps = {
  model: KanbanPageHeaderModel;
};

const TASK_CARD_VIEW_OPTIONS = [
  { value: "normal", label: "Normal", icon: Rows3 },
  { value: "compact", label: "Compact", icon: Rows2 },
] as const;

export function KanbanPageHeader({ model }: KanbanPageHeaderProps): ReactElement {
  const { activeWorkspace } = useWorkspaceState();
  const { taskStoreCheck } = useChecksState();
  const isCreateTaskDisabled = isKanbanTaskCreationDisabled(activeWorkspace, taskStoreCheck);

  return (
    <div className="electron-titlebar-safe-area flex flex-wrap items-center justify-between gap-3 pl-2 pr-4">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Kanban Board</h2>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2" aria-busy={model.isTaskCardViewPending}>
          <TooltipProvider>
            <RadioGroup
              aria-label="Task card view"
              value={model.taskCardView ?? ""}
              disabled={model.taskCardView === null || model.isTaskCardViewPending}
              data-variant="segmented"
              className="flex h-8 w-auto items-center gap-1 rounded-lg bg-muted p-1"
              onValueChange={(taskCardView) => {
                if (taskCardView === "normal" || taskCardView === "compact") {
                  model.onTaskCardViewChange(taskCardView);
                }
              }}
            >
              {TASK_CARD_VIEW_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <RadioGroupSegmentItem
                          value={option.value}
                          aria-label={option.label}
                          className="size-6 flex-none p-0 text-foreground/70 [&_svg]:size-3.5"
                        >
                          <Icon aria-hidden="true" />
                        </RadioGroupSegmentItem>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{option.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </RadioGroup>
          </TooltipProvider>
          {model.isTaskCardViewPending ? (
            <span className="text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span className="sr-only">Saving task card view</span>
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          size="default"
          className="h-10"
          disabled={isCreateTaskDisabled}
          onClick={model.onCreateTask}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          New task
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

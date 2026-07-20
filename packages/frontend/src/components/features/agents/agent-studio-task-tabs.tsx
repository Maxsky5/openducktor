import { DndContext, DragOverlay } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskCard } from "@openducktor/contracts";
import { Circle, CircleAlert, LoaderCircle, Plus, SquareTerminal, X } from "lucide-react";
import { type ReactElement, useMemo, useRef, useState } from "react";
import { TaskSelector } from "@/components/features/tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  horizontalTabDropAnimation,
  horizontalTabSortTransition,
} from "@/components/ui/use-horizontal-sortable-tabs";
import { cn } from "@/lib/utils";
import {
  agentStudioPanelToggleButtonClassName,
  TaskExecutionPanelToggleButton,
  type TaskExecutionPanelToggleModel,
} from "./task-execution-panel";
import { useAgentStudioTaskTabReorderDrag } from "./use-agent-studio-task-tab-reorder-drag";

export type AgentStudioTaskTabStatus = "working" | "idle" | "waiting_input";

export type AgentStudioTaskTab = {
  taskId: string;
  taskTitle: string;
  status: AgentStudioTaskTabStatus;
  isActive: boolean;
};

export type AgentStudioTaskTabsModel = {
  tabs: AgentStudioTaskTab[];
  availableTabTasks: TaskCard[];
  isLoadingAvailableTabTasks: boolean;
  onSelectTab: (taskId: string) => void;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: "before" | "after") => void;
  agentStudioReady: boolean;
};

export type TerminalPanelToggleModel = {
  isVisible: boolean;
  disabled: boolean;
  onToggle: () => void;
};

const taskTabLabelClassName =
  "h-9 max-w-[19rem] cursor-pointer items-center justify-start gap-2 rounded-t-[8px] border-none bg-transparent px-0 pr-1 text-sm font-medium leading-none text-inherit";

const taskTabShellClassName = (tab: AgentStudioTaskTab): string =>
  cn(
    "group relative z-1 inline-flex h-10 shrink-0 cursor-pointer touch-none select-none items-center gap-1 rounded-t-[10px] pl-2 pr-1",
    tab.isActive
      ? "z-10 border-input border-b-transparent bg-card text-foreground hover:bg-card after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-card"
      : "border-input border-b-input bg-secondary text-foreground hover:bg-muted",
  );

function AgentStudioTaskTabContent({ tab }: { tab: AgentStudioTaskTab }): ReactElement {
  const statusLabel = statusLabelByTab(tab.status);
  return (
    <>
      <span
        aria-hidden="true"
        title={statusLabel}
        className="inline-flex size-5 shrink-0 items-center justify-center"
      >
        {statusIconByTab(tab.status)}
      </span>
      <span className="sr-only">{statusLabel}</span>
      <span className="max-w-52 truncate">{tab.taskTitle}</span>
    </>
  );
}

const statusLabelByTab = (status: AgentStudioTaskTabStatus): string => {
  if (status === "working") {
    return "Working";
  }
  if (status === "waiting_input") {
    return "Waiting input";
  }
  return "Idle";
};

const statusIconByTab = (status: AgentStudioTaskTabStatus): ReactElement => {
  if (status === "working") {
    return (
      <span className="agent-studio-task-status-running-dot">
        <Circle className="size-3 fill-status-running text-status-running" />
      </span>
    );
  }
  if (status === "waiting_input") {
    return <CircleAlert className="size-3.5 text-warning-accent" />;
  }
  return <Circle className="size-3.5 fill-input text-input" />;
};

function AgentStudioTaskTabDragOverlay({ tab }: { tab: AgentStudioTaskTab }): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-active={tab.isActive ? "true" : "false"}
      data-dragging="true"
      data-task-tab-id={tab.taskId}
      className={cn(taskTabShellClassName(tab), "z-50 after:hidden")}
    >
      <div className={cn(taskTabLabelClassName, "inline-flex")}>
        <AgentStudioTaskTabContent tab={tab} />
      </div>
      <span
        className="pointer-events-none mr-1 rounded-md p-1 text-muted-foreground opacity-60"
        data-active={tab.isActive ? "true" : "false"}
      >
        <X className="size-3.5" />
      </span>
    </div>
  );
}

function SortableAgentStudioTaskTab({
  tab,
  isActiveDrag,
  shouldSuppressSelection,
  onSelectTab,
  onCloseTab,
}: {
  tab: AgentStudioTaskTab;
  isActiveDrag: boolean;
  shouldSuppressSelection: boolean;
  onSelectTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
}): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.taskId,
    transition: horizontalTabSortTransition,
  });
  const isDragSource = isDragging || isActiveDrag;

  return (
    <div
      ref={setNodeRef}
      data-active={tab.isActive ? "true" : "false"}
      data-dragging={isDragSource ? "true" : "false"}
      data-task-tab-id={tab.taskId}
      className={cn(taskTabShellClassName(tab), isDragSource && "opacity-0")}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...listeners}
    >
      <TabsTrigger
        id={`agent-studio-tab-${tab.taskId}`}
        value={tab.taskId}
        className={cn(
          taskTabLabelClassName,
          "data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        onMouseDown={(event) => event.preventDefault()}
        onMouseUp={(event) => {
          if (shouldSuppressSelection) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onSelectTab(tab.taskId);
        }}
      >
        <AgentStudioTaskTabContent tab={tab} />
      </TabsTrigger>
      <button
        type="button"
        className="mr-1 cursor-pointer rounded-md p-1 text-muted-foreground opacity-60 transition-none hover:bg-secondary hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-active={tab.isActive ? "true" : "false"}
        tabIndex={tab.isActive ? 0 : -1}
        aria-label={`Close tab for ${tab.taskTitle}`}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCloseTab(tab.taskId);
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function AgentStudioTaskTabs({
  model,
  rightPanelToggleModel,
  terminalPanelToggleModel,
}: {
  model: AgentStudioTaskTabsModel;
  rightPanelToggleModel?: TaskExecutionPanelToggleModel | null;
  terminalPanelToggleModel?: TerminalPanelToggleModel;
}): ReactElement {
  const {
    tabs,
    availableTabTasks,
    isLoadingAvailableTabTasks,
    onSelectTab,
    onCreateTab,
    onCloseTab,
    onReorderTab,
    agentStudioReady,
  } = model;
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState("");
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const tabTaskIds = useMemo(() => tabs.map((tab) => tab.taskId), [tabs]);
  const {
    activeTaskId,
    sensors,
    collisionDetection,
    measuring,
    modifiers,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    shouldSuppressSelection,
  } = useAgentStudioTaskTabReorderDrag({
    tabTaskIds,
    onReorderTab,
  });
  const selectedTaskId = availableTabTasks.some((task) => task.id === pendingTaskId)
    ? pendingTaskId
    : (availableTabTasks[0]?.id ?? "");

  const canOpenCreateDialog = agentStudioReady;
  const hasCreatableTasks = availableTabTasks.length > 0;
  const hasAnyTab = tabs.length > 0;
  const activeDragTab = activeTaskId
    ? (tabs.find((tab) => tab.taskId === activeTaskId) ?? null)
    : null;

  return (
    <div className="bg-studio-chrome px-2 pt-1.5 pb-0">
      <div className="flex min-w-0 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div ref={scrollRegionRef} className="hide-scrollbar min-w-0 max-w-full overflow-x-auto">
            <div className="inline-flex h-10 min-w-max items-center gap-1 pl-2">
              {hasAnyTab ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={collisionDetection}
                  measuring={measuring}
                  modifiers={modifiers}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  <SortableContext items={tabTaskIds} strategy={horizontalListSortingStrategy}>
                    <TabsList
                      aria-label="Agent Studio task tabs"
                      className="h-auto min-h-10 w-max justify-start gap-1 rounded-none bg-transparent p-0"
                    >
                      {tabs.map((tab) => (
                        <SortableAgentStudioTaskTab
                          key={tab.taskId}
                          tab={tab}
                          isActiveDrag={activeTaskId === tab.taskId}
                          shouldSuppressSelection={shouldSuppressSelection(tab.taskId)}
                          onSelectTab={onSelectTab}
                          onCloseTab={onCloseTab}
                        />
                      ))}
                    </TabsList>
                  </SortableContext>

                  <DragOverlay dropAnimation={horizontalTabDropAnimation} zIndex={40}>
                    {activeDragTab ? <AgentStudioTaskTabDragOverlay tab={activeDragTab} /> : null}
                  </DragOverlay>
                </DndContext>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Open a task tab to start working with an agent.
                </p>
              )}
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Open new task tab"
            className="size-10 shrink-0 rounded-md border-none border-transparent bg-transparent p-0 text-studio-chrome-foreground shadow-none hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            disabled={!canOpenCreateDialog}
            onClick={() => {
              setPendingTaskId(availableTabTasks[0]?.id ?? "");
              setIsCreateDialogOpen(true);
            }}
          >
            <Plus className="size-[1.4rem]" />
            <span className="sr-only">New Tab</span>
          </Button>
        </div>
        {terminalPanelToggleModel ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={terminalPanelToggleModel.isVisible ? "Hide terminals" : "Show terminals"}
            className={cn(agentStudioPanelToggleButtonClassName, "shrink-0")}
            disabled={terminalPanelToggleModel.disabled}
            onClick={terminalPanelToggleModel.onToggle}
          >
            <SquareTerminal />
          </Button>
        ) : null}
        {rightPanelToggleModel ? (
          <div className="flex shrink-0 items-center pl-0.5">
            <TaskExecutionPanelToggleButton model={rightPanelToggleModel} />
          </div>
        ) : null}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Open Task Tab</DialogTitle>
            <DialogDescription>
              Pick a task to open in this studio view. One task can only have one session.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="py-4">
            {isLoadingAvailableTabTasks ? (
              <div className="relative">
                <TaskSelector
                  tasks={[]}
                  value=""
                  includeEmptyOption
                  emptyLabel="Loading tasks…"
                  searchPlaceholder="Loading tasks…"
                  disabled
                  onValueChange={() => undefined}
                />
                <LoaderCircle className="pointer-events-none absolute right-9 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              </div>
            ) : hasCreatableTasks ? (
              <TaskSelector
                tasks={availableTabTasks}
                value={selectedTaskId}
                includeEmptyOption={false}
                emptyLabel="Select task"
                disabled={!agentStudioReady}
                onValueChange={setPendingTaskId}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                All available tasks already have an open tab.
              </p>
            )}
          </DialogBody>

          <DialogFooter className="mt-0 flex-row justify-between border-t border-border pt-5">
            <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isLoadingAvailableTabTasks || !selectedTaskId || !hasCreatableTasks}
              onClick={() => {
                if (!selectedTaskId) {
                  return;
                }
                onCreateTab(selectedTaskId);
                setIsCreateDialogOpen(false);
              }}
            >
              Open Tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

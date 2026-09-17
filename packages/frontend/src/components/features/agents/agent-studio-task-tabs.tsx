import { DndContext, DragOverlay } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskCard } from "@openducktor/contracts";
import { Circle, CircleAlert, LoaderCircle, Plus, SquareTerminal, X } from "lucide-react";
import { type ReactElement, useMemo, useRef, useState } from "react";
import { TaskSelector } from "@/components/features/tasks";
import { Button } from "@/components/ui/button";
import { RunningStatusDot } from "@/components/ui/running-status-dot";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StudioTabStrip, StudioTabsList, StudioTabTrigger } from "./studio-tab-strip";
import { studioTabLabelClassName, studioTabShellClassName } from "./studio-tab-styles";
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

const taskTabShellClassName = (tab: AgentStudioTaskTab): string =>
  cn(studioTabShellClassName(tab.isActive), "touch-none");

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
    return <RunningStatusDot />;
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
      <div className={cn(studioTabLabelClassName, "inline-flex")}>
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
      <StudioTabTrigger
        id={`agent-studio-tab-${tab.taskId}`}
        value={tab.taskId}
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
      </StudioTabTrigger>
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
    <>
      <StudioTabStrip
        scrollRef={scrollRegionRef}
        createAction={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Open new task tab"
            className="size-8 shrink-0 rounded-md border-none border-transparent bg-transparent p-0 text-studio-chrome-foreground shadow-none hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            disabled={!canOpenCreateDialog}
            onClick={() => {
              setPendingTaskId(availableTabTasks[0]?.id ?? "");
              setIsCreateDialogOpen(true);
            }}
          >
            <Plus className="size-5" />
            <span className="sr-only">New Tab</span>
          </Button>
        }
        actions={
          <>
            {terminalPanelToggleModel ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={
                  terminalPanelToggleModel.isVisible ? "Hide terminals" : "Show terminals"
                }
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
          </>
        }
      >
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
              <StudioTabsList aria-label="Task workflow tabs">
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
              </StudioTabsList>
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
      </StudioTabStrip>

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
    </>
  );
}

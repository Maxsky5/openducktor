import type { TaskCard } from "@openducktor/contracts";
import { Circle, CircleAlert, LoaderCircle, Plus, X } from "lucide-react";
import {
  type DragEvent as ReactDragEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { cn } from "@/lib/utils";
import {
  AgentStudioRightPanelToggleButton,
  type AgentStudioRightPanelToggleModel,
} from "./agent-studio-right-panel";

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
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: "before" | "after") => void;
  agentStudioReady: boolean;
};

const AUTO_SCROLL_EDGE_THRESHOLD = 48;
const AUTO_SCROLL_MAX_STEP = 18;

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
    return <LoaderCircle className="size-3.5 animate-spin text-primary" />;
  }
  if (status === "waiting_input") {
    return <CircleAlert className="size-3.5 text-warning-accent" />;
  }
  return <Circle className="size-3.5 fill-input text-input" />;
};

export function AgentStudioTaskTabs({
  model,
  rightPanelToggleModel,
}: {
  model: AgentStudioTaskTabsModel;
  rightPanelToggleModel?: AgentStudioRightPanelToggleModel | null;
}): ReactElement {
  const {
    tabs,
    availableTabTasks,
    isLoadingAvailableTabTasks,
    onCreateTab,
    onCloseTab,
    onReorderTab,
    agentStudioReady,
  } = model;
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState("");
  const [isCreateDialogReady, setIsCreateDialogReady] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    position: "before" | "after";
  } | null>(null);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollStepRef = useRef(0);

  useEffect(() => {
    if (!isCreateDialogOpen) {
      setIsCreateDialogReady(false);
      return;
    }
    const frame = globalThis.requestAnimationFrame(() => setIsCreateDialogReady(true));
    return () => globalThis.cancelAnimationFrame(frame);
  }, [isCreateDialogOpen]);

  useEffect(() => {
    if (!isCreateDialogOpen) {
      return;
    }
    if (availableTabTasks.length === 0) {
      setPendingTaskId("");
      return;
    }
    if (availableTabTasks.some((task) => task.id === pendingTaskId)) {
      return;
    }
    setPendingTaskId(availableTabTasks[0]?.id ?? "");
  }, [availableTabTasks, isCreateDialogOpen, pendingTaskId]);

  const canOpenCreateDialog = agentStudioReady;
  const hasCreatableTasks = availableTabTasks.length > 0;
  const hasAnyTab = tabs.length > 0;

  const stopAutoScroll = (): void => {
    if (autoScrollFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    autoScrollStepRef.current = 0;
  };

  const updateAutoScroll = (clientX: number): void => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      stopAutoScroll();
      return;
    }

    const bounds = scrollRegion.getBoundingClientRect();
    let nextStep = 0;

    if (clientX < bounds.left + AUTO_SCROLL_EDGE_THRESHOLD) {
      const distanceToEdge = bounds.left + AUTO_SCROLL_EDGE_THRESHOLD - clientX;
      nextStep = -Math.min(
        AUTO_SCROLL_MAX_STEP,
        Math.max(4, (distanceToEdge / AUTO_SCROLL_EDGE_THRESHOLD) * AUTO_SCROLL_MAX_STEP),
      );
    } else if (clientX > bounds.right - AUTO_SCROLL_EDGE_THRESHOLD) {
      const distanceToEdge = clientX - (bounds.right - AUTO_SCROLL_EDGE_THRESHOLD);
      nextStep = Math.min(
        AUTO_SCROLL_MAX_STEP,
        Math.max(4, (distanceToEdge / AUTO_SCROLL_EDGE_THRESHOLD) * AUTO_SCROLL_MAX_STEP),
      );
    }

    autoScrollStepRef.current = nextStep;

    if (nextStep === 0) {
      stopAutoScroll();
      return;
    }

    if (autoScrollFrameRef.current !== null) {
      return;
    }

    const step = (): void => {
      const nextScrollRegion = scrollRegionRef.current;
      if (!nextScrollRegion || autoScrollStepRef.current === 0) {
        autoScrollFrameRef.current = null;
        return;
      }

      nextScrollRegion.scrollLeft += autoScrollStepRef.current;
      autoScrollFrameRef.current = globalThis.requestAnimationFrame(step);
    };

    autoScrollFrameRef.current = globalThis.requestAnimationFrame(step);
  };

  const clearDragState = (): void => {
    setDraggedTaskId(null);
    setDropTarget(null);
    stopAutoScroll();
  };

  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(autoScrollFrameRef.current);
      }
    };
  }, []);

  const handleTabDragStart =
    (taskId: string) =>
    (event: ReactDragEvent<HTMLElement>): void => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", taskId);
      setDraggedTaskId(taskId);
      setDropTarget(null);
    };

  const handleTabDragOver =
    (taskId: string) =>
    (event: ReactDragEvent<HTMLElement>): void => {
      if (!draggedTaskId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      updateAutoScroll(event.clientX);

      if (draggedTaskId === taskId) {
        setDropTarget(null);
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();
      const position = event.clientX <= bounds.left + bounds.width / 2 ? "before" : "after";
      setDropTarget((current) => {
        if (current?.taskId === taskId && current.position === position) {
          return current;
        }
        return { taskId, position };
      });
    };

  const handleTabDrop = (event: ReactDragEvent<HTMLElement>): void => {
    if (!draggedTaskId || !dropTarget) {
      clearDragState();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onReorderTab(draggedTaskId, dropTarget.taskId, dropTarget.position);
    clearDragState();
  };

  return (
    <div className="bg-studio-chrome px-2 pt-1.5 pb-0">
      <div className="flex min-w-0 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div ref={scrollRegionRef} className="hide-scrollbar min-w-0 max-w-full overflow-x-auto">
            <div className="inline-flex h-10 min-w-max items-center gap-1 pl-2">
              {hasAnyTab ? (
                <TabsList
                  aria-label="Agent Studio task tabs"
                  className="h-auto min-h-10 w-max justify-start gap-1 rounded-none bg-transparent p-0"
                  onDragOver={(event) => {
                    if (!draggedTaskId) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    updateAutoScroll(event.clientX);
                  }}
                  onDrop={() => {
                    clearDragState();
                  }}
                >
                  {tabs.map((tab) => (
                    <div
                      key={tab.taskId}
                      data-active={tab.isActive ? "true" : "false"}
                      data-dragging={draggedTaskId === tab.taskId ? "true" : "false"}
                      data-drop-position={
                        dropTarget?.taskId === tab.taskId ? dropTarget.position : undefined
                      }
                      data-task-tab-id={tab.taskId}
                      className={cn(
                        "group relative z-1 inline-flex h-10 shrink-0 items-center gap-1 rounded-t-[10px] pl-2 pr-1",
                        draggedTaskId === tab.taskId && "cursor-grabbing opacity-60",
                        tab.isActive
                          ? "z-10 border-input border-b-transparent bg-card text-foreground hover:bg-card after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-card"
                          : "border-input border-b-input bg-secondary text-foreground hover:bg-muted",
                      )}
                    >
                      {dropTarget?.taskId === tab.taskId && dropTarget.position === "before" ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-1 left-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-primary"
                        />
                      ) : null}
                      {dropTarget?.taskId === tab.taskId && dropTarget.position === "after" ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-1 right-0 z-20 w-0.5 translate-x-1/2 rounded-full bg-primary"
                        />
                      ) : null}
                      <TabsTrigger
                        id={`agent-studio-tab-${tab.taskId}`}
                        value={tab.taskId}
                        draggable
                        className={cn(
                          "h-9 max-w-[19rem] cursor-pointer justify-start gap-2 rounded-t-[8px] border-none bg-transparent px-0 pr-1 text-sm font-medium leading-none",
                          "text-inherit data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        )}
                        onDragStart={handleTabDragStart(tab.taskId)}
                        onDragOver={handleTabDragOver(tab.taskId)}
                        onDragEnd={clearDragState}
                        onDrop={handleTabDrop}
                      >
                        <span
                          role="img"
                          aria-label={statusLabelByTab(tab.status)}
                          title={statusLabelByTab(tab.status)}
                          className="inline-flex size-5 shrink-0 items-center justify-center"
                        >
                          {statusIconByTab(tab.status)}
                        </span>
                        <span className="max-w-52 truncate">{tab.taskTitle}</span>
                      </TabsTrigger>
                      <button
                        type="button"
                        draggable={false}
                        className={cn(
                          "mr-1 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          "opacity-60 group-hover:opacity-100 data-[active=true]:opacity-100",
                        )}
                        data-active={tab.isActive ? "true" : "false"}
                        tabIndex={tab.isActive ? 0 : -1}
                        aria-label={`Close tab for ${tab.taskTitle}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onCloseTab(tab.taskId);
                        }}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </TabsList>
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
            className="h-10 w-10 shrink-0 rounded-md border-none border-transparent bg-transparent p-0 text-studio-chrome-foreground shadow-none hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            disabled={!canOpenCreateDialog}
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="size-[1.4rem]" />
            <span className="sr-only">New Tab</span>
          </Button>
        </div>
        {rightPanelToggleModel ? (
          <div className="flex shrink-0 items-center pl-0.5">
            <AgentStudioRightPanelToggleButton model={rightPanelToggleModel} />
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
            {!isCreateDialogReady || isLoadingAvailableTabTasks ? (
              <div className="relative">
                <TaskSelector
                  tasks={[]}
                  value=""
                  includeEmptyOption
                  emptyLabel="Loading tasks..."
                  searchPlaceholder="Loading tasks..."
                  disabled
                  onValueChange={() => undefined}
                />
                <LoaderCircle className="pointer-events-none absolute right-9 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              </div>
            ) : hasCreatableTasks ? (
              <TaskSelector
                tasks={availableTabTasks}
                value={pendingTaskId}
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
              disabled={isLoadingAvailableTabTasks || !pendingTaskId || !hasCreatableTasks}
              onClick={() => {
                if (!pendingTaskId) {
                  return;
                }
                onCreateTab(pendingTaskId);
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

import type { TaskCard } from "@openducktor/contracts";
import { Circle, CircleAlert, LoaderCircle, Plus, X } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { TaskSelector } from "@/components/features/tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
  agentStudioReady: boolean;
};

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
    agentStudioReady,
  } = model;
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState("");
  const [isCreateDialogReady, setIsCreateDialogReady] = useState(false);

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
  const hasAnyTab = useMemo(() => tabs.length > 0, [tabs]);

  return (
    <div className="bg-studio-chrome px-2 pt-1.5 pb-0">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="inline-flex h-10 min-w-max items-center gap-1 px-2">
            {hasAnyTab ? (
              <TabsList
                aria-label="Agent Studio task tabs"
                className="h-auto min-h-10 w-max justify-start gap-1 rounded-none bg-transparent p-0"
              >
                {tabs.map((tab) => (
                  <div
                    key={tab.taskId}
                    data-active={tab.isActive ? "true" : "false"}
                    className={cn(
                      "group relative z-1 inline-flex h-10 shrink-0 items-center gap-1 rounded-t-[10px] pl-2 pr-1",
                      "transition-colors",
                      tab.isActive
                        ? "z-10 border-input border-b-transparent bg-card text-foreground hover:bg-card after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-card"
                        : "border-input border-b-input bg-secondary text-foreground hover:bg-muted",
                    )}
                  >
                    <TabsTrigger
                      id={`agent-studio-tab-${tab.taskId}`}
                      value={tab.taskId}
                      className={cn(
                        "h-9 max-w-[19rem] cursor-pointer justify-start gap-2 rounded-t-[8px] border-none bg-transparent px-0 pr-1 text-sm font-medium leading-none",
                        "text-inherit data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      )}
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
                      className={cn(
                        "mr-1 cursor-pointer rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground",
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

          <DialogFooter>
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

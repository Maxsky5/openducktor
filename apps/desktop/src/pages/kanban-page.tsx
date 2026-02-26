import { mapToKanbanColumns } from "@openducktor/core";
import { Loader2, Plus, RefreshCcw } from "lucide-react";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KanbanColumn, KanbanSummaryCards } from "@/components/features/kanban";
import { TaskCreateModal } from "@/components/features/task-create-modal";
import { TaskDetailsSheet } from "@/components/features/task-details-sheet";
import { Button } from "@/components/ui/button";
import { useTasksState, useWorkspaceState } from "@/state";

export function KanbanPage(): ReactElement {
  const { isSwitchingWorkspace } = useWorkspaceState();
  const {
    tasks,
    runs,
    refreshTasks,
    isLoadingTasks,
    deleteTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  } = useTasksState();
  const navigate = useNavigate();
  const [isTaskComposerOpen, setTaskComposerOpen] = useState(false);
  const [composerTaskId, setComposerTaskId] = useState<string | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);

  const columns = useMemo(() => mapToKanbanColumns(tasks), [tasks]);
  const runStateByTaskId = useMemo(
    () => new Map(runs.map((run) => [run.taskId, run.state])),
    [runs],
  );
  const runningCount = useMemo(
    () => runs.filter((run) => run.state === "running" || run.state === "starting").length,
    [runs],
  );
  const blockedCount = useMemo(
    () => tasks.filter((task) => task.status === "blocked").length,
    [tasks],
  );
  const doneCount = useMemo(() => tasks.filter((task) => task.status === "closed").length, [tasks]);
  const detailsTask = useMemo(
    () => tasks.find((task) => task.id === detailsTaskId) ?? null,
    [detailsTaskId, tasks],
  );
  const composerTask = useMemo(
    () => tasks.find((task) => task.id === composerTaskId) ?? null,
    [composerTaskId, tasks],
  );

  const openAgents = useCallback(
    (
      taskId: string,
      agent: "spec" | "planner" | "build" | "qa",
      options?: {
        scenario?: string;
        autostart?: boolean;
        start?: "fresh" | "continue";
      },
    ) => {
      const params = new URLSearchParams({
        task: taskId,
        agent,
      });
      if (options?.scenario) {
        params.set("scenario", options.scenario);
      }
      if (options?.autostart) {
        params.set("autostart", "1");
      }
      if (options?.start) {
        params.set("start", options.start);
      }
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const getPlanningStartPreference = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): "fresh" | "continue" => {
      if (action === "set_plan") {
        return "fresh";
      }
      const task = tasks.find((entry) => entry.id === taskId);
      return task?.status === "spec_ready" ? "continue" : "fresh";
    },
    [tasks],
  );

  return (
    <div className="grid min-h-full min-w-0 gap-4 overflow-x-hidden p-4">
      <KanbanSummaryCards
        taskCount={tasks.length}
        runningCount={runningCount}
        blockedCount={blockedCount}
        doneCount={doneCount}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Kanban Board</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="default"
            className="h-10"
            onClick={() => {
              setComposerTaskId(null);
              setTaskComposerOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Create Task
          </Button>
          <Button
            type="button"
            size="default"
            variant="outline"
            className="h-10"
            disabled={isLoadingTasks || isSwitchingWorkspace}
            onClick={() => void refreshTasks()}
          >
            {isLoadingTasks ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
            {isLoadingTasks ? "Refreshing..." : "Refresh Tasks"}
          </Button>
        </div>
      </div>

      <section className="min-h-0 min-w-0">
        <div className="hide-scrollbar max-w-full overflow-x-auto">
          <div className="flex min-w-max items-stretch gap-4">
            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                runStateByTaskId={runStateByTaskId}
                onOpenDetails={(taskId) => setDetailsTaskId(taskId)}
                onDelegate={(taskId) =>
                  openAgents(taskId, "build", {
                    scenario: "build_implementation_start",
                    autostart: true,
                  })
                }
                onPlan={(taskId, action) => {
                  const startPreference = getPlanningStartPreference(taskId, action);
                  openAgents(taskId, action === "set_spec" ? "spec" : "planner", {
                    autostart: startPreference === "fresh",
                    start: startPreference,
                  });
                }}
                onBuild={(taskId) => {
                  openAgents(taskId, "build");
                }}
                onHumanApprove={(taskId) => void humanApproveTask(taskId)}
                onHumanRequestChanges={(taskId) => {
                  void (async () => {
                    await humanRequestChangesTask(taskId);
                    openAgents(taskId, "build", {
                      scenario: "build_after_human_request_changes",
                      autostart: true,
                    });
                  })();
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <TaskCreateModal
        open={isTaskComposerOpen}
        task={composerTask}
        onOpenChange={(nextOpen) => {
          setTaskComposerOpen(nextOpen);
          if (!nextOpen) {
            setComposerTaskId(null);
          }
        }}
        tasks={tasks}
      />
      <TaskDetailsSheet
        task={detailsTask}
        allTasks={tasks}
        open={detailsTask !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsTaskId(null);
          }
        }}
        onPlan={(taskId, action) => {
          const startPreference = getPlanningStartPreference(taskId, action);
          openAgents(taskId, action === "set_spec" ? "spec" : "planner", {
            autostart: startPreference === "fresh",
            start: startPreference,
          });
        }}
        onBuild={(taskId) => {
          openAgents(taskId, "build");
        }}
        onDelegate={(taskId) => {
          openAgents(taskId, "build", {
            scenario: "build_implementation_start",
            autostart: true,
          });
        }}
        onEdit={(taskId) => {
          setDetailsTaskId(null);
          setComposerTaskId(taskId);
          setTaskComposerOpen(true);
        }}
        onDefer={(taskId) => void deferTask(taskId)}
        onResumeDeferred={(taskId) => void resumeDeferredTask(taskId)}
        onHumanApprove={(taskId) => void humanApproveTask(taskId)}
        onHumanRequestChanges={(taskId) => {
          void (async () => {
            await humanRequestChangesTask(taskId);
            openAgents(taskId, "build", {
              scenario: "build_after_human_request_changes",
              autostart: true,
            });
          })();
        }}
        onDelete={(taskId, options) => deleteTask(taskId, options.deleteSubtasks)}
      />
    </div>
  );
}

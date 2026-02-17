import { KanbanColumn, KanbanSummaryCards } from "@/components/features/kanban";
import { TaskCreateModal } from "@/components/features/task-create-modal";
import { TaskDetailsSheet } from "@/components/features/task-details-sheet";
import { Button } from "@/components/ui/button";
import { useDelegationState, useTasksState, useWorkspaceState } from "@/state";
import { mapToKanbanColumns } from "@openblueprint/core";
import { Loader2, Plus, RefreshCcw } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

export function KanbanPage(): ReactElement {
  const { delegateTask } = useDelegationState();
  const { isSwitchingWorkspace } = useWorkspaceState();
  const {
    tasks,
    runs,
    refreshTasks,
    isLoadingTasks,
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

  return (
    <div className="grid h-full min-w-0 gap-4 overflow-x-hidden">
      <KanbanSummaryCards
        taskCount={tasks.length}
        runningCount={runningCount}
        blockedCount={blockedCount}
        doneCount={doneCount}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-slate-800">Kanban Board</h2>
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

      <section className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white/85 to-slate-50/70 p-3 shadow-sm">
        <div className="max-w-full overflow-x-auto pb-2">
          <div className="flex min-w-max items-stretch gap-4 pr-2">
            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                runStateByTaskId={runStateByTaskId}
                onOpenDetails={(taskId) => setDetailsTaskId(taskId)}
                onDelegate={(taskId) => void delegateTask(taskId)}
                onPlan={(taskId) => {
                  navigate(`/planner?task=${encodeURIComponent(taskId)}`);
                }}
                onBuild={(taskId) => {
                  navigate(`/builder?task=${encodeURIComponent(taskId)}`);
                }}
                onHumanApprove={(taskId) => void humanApproveTask(taskId)}
                onHumanRequestChanges={(taskId) => void humanRequestChangesTask(taskId)}
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
        onPlan={(taskId) => {
          navigate(`/planner?task=${encodeURIComponent(taskId)}`);
        }}
        onBuild={(taskId) => {
          navigate(`/builder?task=${encodeURIComponent(taskId)}`);
        }}
        onDelegate={(taskId) => {
          void delegateTask(taskId);
        }}
        onEdit={(taskId) => {
          setDetailsTaskId(null);
          setComposerTaskId(taskId);
          setTaskComposerOpen(true);
        }}
        onDefer={(taskId) => void deferTask(taskId)}
        onResumeDeferred={(taskId) => void resumeDeferredTask(taskId)}
        onHumanApprove={(taskId) => void humanApproveTask(taskId)}
        onHumanRequestChanges={(taskId) => void humanRequestChangesTask(taskId)}
      />
    </div>
  );
}

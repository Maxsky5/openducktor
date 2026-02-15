import { KanbanColumn, KanbanSummaryCards } from "@/components/features/kanban";
import { TaskCreateModal } from "@/components/features/task-create-modal";
import { TaskDetailsSheet } from "@/components/features/task-details-sheet";
import { Button } from "@/components/ui/button";
import { useOrchestrator } from "@/state";
import { mapToKanbanColumns } from "@openblueprint/core";
import { Loader2, Plus, RefreshCcw } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

export function KanbanPage(): ReactElement {
  const {
    tasks,
    runs,
    setTaskPhase,
    delegateTask,
    setSelectedTaskId,
    refreshTasks,
    isLoadingTasks,
    isSwitchingWorkspace,
  } = useOrchestrator();
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
    () => tasks.filter((task) => task.phase === "blocked_needs_input").length,
    [tasks],
  );
  const doneCount = useMemo(() => tasks.filter((task) => task.phase === "done").length, [tasks]);
  const detailsTask = useMemo(
    () => tasks.find((task) => task.id === detailsTaskId) ?? null,
    [detailsTaskId, tasks],
  );
  const composerTask = useMemo(
    () => tasks.find((task) => task.id === composerTaskId) ?? null,
    [composerTaskId, tasks],
  );

  return (
    <div className="grid h-full gap-4">
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

      <section className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-6">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            runStateByTaskId={runStateByTaskId}
            onOpenDetails={(taskId) => setDetailsTaskId(taskId)}
            onSetPhase={(taskId, phase) => void setTaskPhase(taskId, phase)}
            onDelegate={(taskId) => void delegateTask(taskId)}
            onPlan={(taskId) => {
              setSelectedTaskId(taskId);
              navigate(`/planner?task=${encodeURIComponent(taskId)}`);
            }}
            onBuild={(taskId) => {
              setSelectedTaskId(taskId);
              navigate(`/builder?task=${encodeURIComponent(taskId)}`);
            }}
          />
        ))}
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
          setSelectedTaskId(taskId);
          navigate(`/planner?task=${encodeURIComponent(taskId)}`);
        }}
        onBuild={(taskId) => {
          setSelectedTaskId(taskId);
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
      />
    </div>
  );
}

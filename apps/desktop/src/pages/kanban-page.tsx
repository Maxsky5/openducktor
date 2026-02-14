import { WorkspaceToolbar } from "@/components/features/workspace-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PHASE_OPTIONS, phaseLabel } from "@/lib/task-phase";
import { useOrchestrator } from "@/state/orchestrator-context";
import type { TaskPhase } from "@openblueprint/contracts";
import { mapToKanbanColumns } from "@openblueprint/core";
import {
  Clock3,
  Loader2,
  Play,
  RefreshCcw,
  ScrollText,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const phaseBadgeVariant = (phase?: TaskPhase): "secondary" | "warning" | "danger" | "success" => {
  if (!phase) {
    return "secondary";
  }

  if (phase === "blocked_needs_input") {
    return "danger";
  }
  if (phase === "done") {
    return "success";
  }
  if (phase === "in_progress") {
    return "warning";
  }
  return "secondary";
};

export function KanbanPage(): ReactElement {
  const {
    tasks,
    runs,
    createTask,
    setTaskPhase,
    delegateTask,
    setSelectedTaskId,
    refreshTasks,
    isLoadingTasks,
    isSwitchingWorkspace,
  } = useOrchestrator();
  const [title, setTitle] = useState("");

  const columns = useMemo(() => mapToKanbanColumns(tasks), [tasks]);
  const runByTask = useMemo(() => new Map(runs.map((run) => [run.taskId, run])), [runs]);
  const runningCount = useMemo(
    () => runs.filter((run) => run.state === "running" || run.state === "starting").length,
    [runs],
  );
  const blockedCount = useMemo(
    () => tasks.filter((task) => task.phase === "blocked_needs_input").length,
    [tasks],
  );
  const doneCount = useMemo(() => tasks.filter((task) => task.phase === "done").length, [tasks]);

  return (
    <div className="grid h-full gap-4">
      <WorkspaceToolbar />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="animate-rise-in border-sky-200 bg-gradient-to-br from-sky-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">Total Tasks</CardTitle>
            <CardDescription>All lanes</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tracking-tight text-slate-900">
            {tasks.length}
          </CardContent>
        </Card>
        <Card className="animate-rise-in border-amber-200 bg-gradient-to-br from-amber-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
              <Clock3 className="size-4 text-amber-600" />
              Active Runs
            </CardTitle>
            <CardDescription>Builder execution in-flight</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tracking-tight text-slate-900">
            {runningCount}
          </CardContent>
        </Card>
        <Card className="animate-rise-in border-rose-200 bg-gradient-to-br from-rose-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
              <ShieldAlert className="size-4 text-rose-600" />
              Blocked
            </CardTitle>
            <CardDescription>Needs human decision</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tracking-tight text-slate-900">
            {blockedCount}
          </CardContent>
        </Card>
        <Card className="animate-rise-in border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">Done</CardTitle>
            <CardDescription>Closed successfully</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tracking-tight text-slate-900">
            {doneCount}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Create Work Item</CardTitle>
          <CardDescription>
            Add a task, route it to Planner for specification, then delegate to Builder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createTask(title);
              setTitle("");
            }}
          >
            <Input
              className="min-w-[280px] flex-1"
              placeholder="Describe the feature, bug, or refactor"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
            <Button type="submit" disabled={!title.trim()}>
              Create Task
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-slate-800">Kanban Board</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoadingTasks || isSwitchingWorkspace}
          onClick={() => void refreshTasks()}
        >
          {isLoadingTasks ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCcw className="size-3" />
          )}
          {isLoadingTasks ? "Refreshing..." : "Refresh Tasks"}
        </Button>
      </div>

      <section className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-6">
        {columns.map((column) => (
          <Card key={column.id} className="min-h-[320px] border-slate-200/90">
            <CardHeader className="rounded-t-xl border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
              <CardTitle className="text-sm uppercase tracking-wide text-slate-700">
                {column.title}
              </CardTitle>
              <CardDescription>{column.tasks.length} task(s)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {column.tasks.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">
                  No tasks in this lane.
                </div>
              ) : null}

              {column.tasks.map((task) => {
                const run = runByTask.get(task.id);
                return (
                  <article
                    key={task.id}
                    className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <p className="text-sm font-semibold leading-tight text-slate-900">
                      {task.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={phaseBadgeVariant(task.phase)}>
                        {phaseLabel(task.phase)}
                      </Badge>
                      {run ? <Badge variant="warning">Run {run.state}</Badge> : null}
                    </div>

                    <select
                      className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                      value={task.phase ?? "backlog"}
                      onChange={(event) => {
                        void setTaskPhase(task.id, event.currentTarget.value as TaskPhase);
                      }}
                    >
                      {PHASE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" size="sm" variant="outline" asChild>
                        <Link
                          to={`/planner?task=${encodeURIComponent(task.id)}`}
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          <ScrollText className="size-3" /> Plan
                        </Link>
                      </Button>
                      <Button type="button" size="sm" variant="outline" asChild>
                        <Link
                          to={`/builder?task=${encodeURIComponent(task.id)}`}
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          <WandSparkles className="size-3" /> Build
                        </Link>
                      </Button>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      onClick={() => void delegateTask(task.id)}
                    >
                      <Play className="size-3" /> Delegate
                    </Button>
                  </article>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

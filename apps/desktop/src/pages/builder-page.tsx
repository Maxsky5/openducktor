import { AgentChatPanel } from "@/components/features/agent-chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOrchestrator } from "@/state/orchestrator-context";
import { Activity, CircleSlash2, GitBranch, ShieldAlert } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function BuilderPage(): ReactElement {
  const {
    tasks,
    runs,
    events,
    selectedTask,
    setSelectedTaskId,
    delegateTask,
    delegateRespond,
    delegateStop,
    delegateCleanup,
  } = useOrchestrator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runMessageById, setRunMessageById] = useState<Record<string, string>>({});

  const taskId = searchParams.get("task") ?? selectedTask?.id ?? "";
  const taskRuns = useMemo(
    () => runs.filter((run) => !taskId || run.taskId === taskId),
    [runs, taskId],
  );
  const blockedRuns = useMemo(() => runs.filter((run) => run.state === "blocked").length, [runs]);
  const activeRuns = useMemo(
    () => runs.filter((run) => run.state === "starting" || run.state === "running").length,
    [runs],
  );

  return (
    <div className="grid h-full gap-4 xl:grid-cols-[minmax(360px,1fr)_minmax(420px,1.2fr)]">
      <AgentChatPanel
        mode="builder"
        conversationId={`builder-${taskId || "none"}`}
        title="Builder Agent"
        subtitle="Supervise execution, unblock approvals, and steer delivery."
      />

      <div className="grid gap-4">
        <section className="grid gap-3 md:grid-cols-3">
          <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
                <Activity className="size-4 text-emerald-600" />
                Active Runs
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{activeRuns}</CardContent>
          </Card>
          <Card className="border-rose-200 bg-gradient-to-br from-rose-50 to-white">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
                <ShieldAlert className="size-4 text-rose-600" />
                Blocked
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{blockedRuns}</CardContent>
          </Card>
          <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-white">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
                <CircleSlash2 className="size-4 text-slate-600" />
                Event Entries
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{events.length}</CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Execution Control</CardTitle>
            <CardDescription>
              Dedicated supervision and HITL approvals for active runs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 min-w-[260px] rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={taskId}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setSelectedTaskId(next || null);
                  setSearchParams(next ? { task: next } : {});
                }}
              >
                <option value="">Select task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.id} - {task.title}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                disabled={!taskId}
                onClick={() => taskId && void delegateTask(taskId)}
              >
                Delegate Task
              </Button>
            </div>

            <div className="space-y-2">
              {taskRuns.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                  No runs for selected task.
                </div>
              ) : null}
              {taskRuns.map((run) => (
                <article
                  key={run.runId}
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
                      {run.runId}
                    </code>
                    <Badge variant={run.state === "blocked" ? "danger" : "warning"}>
                      {run.state}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <GitBranch className="size-3" />
                      {run.branch}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void delegateRespond(run.runId, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void delegateRespond(run.runId, "deny")}
                    >
                      Deny
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void delegateStop(run.runId)}
                    >
                      Stop
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void delegateCleanup(run.runId, "success")}
                    >
                      Cleanup Success
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void delegateCleanup(run.runId, "failure")}
                    >
                      Cleanup Failure
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      placeholder="Reply to agent"
                      value={runMessageById[run.runId] ?? ""}
                      onChange={(event) =>
                        setRunMessageById((current) => ({
                          ...current,
                          [run.runId]: event.currentTarget.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const message = (runMessageById[run.runId] ?? "").trim();
                        if (!message) {
                          return;
                        }
                        void delegateRespond(run.runId, "message", message);
                        setRunMessageById((current) => ({ ...current, [run.runId]: "" }));
                      }}
                    >
                      Send
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity Stream</CardTitle>
            <CardDescription>Structured event feed from orchestrated agent runs.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[360px] space-y-2 overflow-y-auto">
            {events.length === 0 ? <p className="text-sm text-slate-500">No events yet.</p> : null}
            {events.map((event, index) => (
              <article
                key={`${event.type}-${event.timestamp}-${index}`}
                className="rounded-md border border-slate-200 p-3 text-sm"
              >
                <header className="mb-1 flex items-center justify-between gap-2">
                  <Badge variant="secondary">{event.type}</Badge>
                  <time className="text-xs text-slate-400">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </time>
                </header>
                <p className="text-slate-700">{event.message}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

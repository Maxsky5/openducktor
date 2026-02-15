import { AgentChatPanel } from "@/components/features/agent-chat-panel";
import { ActivityStream } from "@/components/features/builder/activity-stream";
import { ExecutionSummaryCards } from "@/components/features/builder/execution-summary-cards";
import { RunControlCard } from "@/components/features/builder/run-control-card";
import { TaskSelector } from "@/components/features/tasks/task-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrchestrator } from "@/state/orchestrator-context";
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
        <ExecutionSummaryCards
          activeRuns={activeRuns}
          blockedRuns={blockedRuns}
          eventCount={events.length}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Execution Control</CardTitle>
            <CardDescription>
              Dedicated supervision and HITL approvals for active runs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[260px]">
                <TaskSelector
                  tasks={tasks}
                  value={taskId}
                  onValueChange={(nextTaskId) => {
                    setSelectedTaskId(nextTaskId || null);
                    setSearchParams(nextTaskId ? { task: nextTaskId } : {});
                  }}
                />
              </div>
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
                <RunControlCard
                  key={run.runId}
                  run={run}
                  message={runMessageById[run.runId] ?? ""}
                  onMessageChange={(runId, value) =>
                    setRunMessageById((current) => ({
                      ...current,
                      [runId]: value,
                    }))
                  }
                  onApprove={(runId) => void delegateRespond(runId, "approve")}
                  onDeny={(runId) => void delegateRespond(runId, "deny")}
                  onStop={(runId) => void delegateStop(runId)}
                  onCleanupSuccess={(runId) => void delegateCleanup(runId, "success")}
                  onCleanupFailure={(runId) => void delegateCleanup(runId, "failure")}
                  onSendMessage={(runId, message) => {
                    const trimmed = message.trim();
                    if (!trimmed) {
                      return;
                    }
                    void delegateRespond(runId, "message", trimmed);
                    setRunMessageById((current) => ({ ...current, [runId]: "" }));
                  }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity Stream</CardTitle>
            <CardDescription>Structured event feed from orchestrated agent runs.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityStream events={events} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

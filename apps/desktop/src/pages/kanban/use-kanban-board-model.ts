import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { mapToKanbanColumns } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const ACTIVE_SESSION_STATUS = new Set<AgentSessionState["status"]>(["starting", "running"]);

const compareRunRecency = (left: RunSummary, right: RunSummary): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.runId === right.runId) {
    return 0;
  }
  return left.runId > right.runId ? -1 : 1;
};

const compareActiveSessionOrder = (left: AgentSessionState, right: AgentSessionState): number => {
  if (left.status !== right.status) {
    return left.status === "running" ? -1 : 1;
  }
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.sessionId === right.sessionId) {
    return 0;
  }
  return left.sessionId > right.sessionId ? -1 : 1;
};

export const buildRunStateByTaskId = (runs: RunSummary[]): Map<string, RunSummary["state"]> => {
  const latestRunByTaskId = new Map<string, RunSummary>();

  for (const run of runs) {
    const current = latestRunByTaskId.get(run.taskId);
    if (!current || compareRunRecency(run, current) < 0) {
      latestRunByTaskId.set(run.taskId, run);
    }
  }

  return new Map(
    Array.from(latestRunByTaskId.entries()).map(([taskId, run]) => [taskId, run.state]),
  );
};

export const sortTasksByActiveSession = (
  tasks: TaskCard[],
  activeSessionsByTaskId: Map<string, AgentSessionState[]>,
): TaskCard[] => {
  const hasActive = (task: TaskCard) => activeSessionsByTaskId.has(task.id);
  return [...tasks].sort((a, b) => Number(hasActive(b)) - Number(hasActive(a)));
};

export const buildActiveSessionsByTaskId = (
  sessions: AgentSessionState[],
): Map<string, AgentSessionState[]> => {
  const sessionsByTaskId = new Map<string, AgentSessionState[]>();
  for (const session of sessions) {
    if (!ACTIVE_SESSION_STATUS.has(session.status)) {
      continue;
    }

    const existing = sessionsByTaskId.get(session.taskId);
    if (existing) {
      existing.push(session);
    } else {
      sessionsByTaskId.set(session.taskId, [session]);
    }
  }

  for (const taskSessions of sessionsByTaskId.values()) {
    taskSessions.sort(compareActiveSessionOrder);
  }

  return sessionsByTaskId;
};

type UseKanbanBoardModelArgs = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  tasks: TaskCard[];
  runs: RunSummary[];
  sessions: AgentSessionState[];
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string) => void;
};

export function useKanbanBoardModel({
  isLoadingTasks,
  isSwitchingWorkspace,
  tasks,
  runs,
  sessions,
  onOpenDetails,
  onDelegate,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: UseKanbanBoardModelArgs): KanbanPageContentModel {
  const columns = useMemo(() => mapToKanbanColumns(tasks), [tasks]);

  const runStateByTaskId = useMemo(() => buildRunStateByTaskId(runs), [runs]);

  const activeSessionsByTaskId = useMemo(() => buildActiveSessionsByTaskId(sessions), [sessions]);

  const columnsWithSortedTasks = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        tasks: sortTasksByActiveSession(col.tasks, activeSessionsByTaskId),
      })),
    [columns, activeSessionsByTaskId],
  );

  return {
    isLoadingTasks,
    isSwitchingWorkspace,
    columns: columnsWithSortedTasks,
    runStateByTaskId,
    activeSessionsByTaskId,
    onOpenDetails,
    onDelegate,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanApprove,
    onHumanRequestChanges,
    onResetImplementation,
  };
}

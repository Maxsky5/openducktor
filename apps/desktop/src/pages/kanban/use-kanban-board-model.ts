import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { mapToKanbanColumns } from "@openducktor/core";
import { useMemo } from "react";
import {
  type KanbanTaskActivityState,
  type KanbanTaskSession,
  toKanbanSessionPresentationState,
  toKanbanTaskActivityState,
} from "@/components/features/kanban/kanban-task-activity";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const ACTIVE_SESSION_STATUS = new Set<AgentSessionState["status"]>(["starting", "running"]);

const shouldDisplayKanbanTaskSession = (session: AgentSessionState): boolean => {
  if (isAgentSessionWaitingInput(session)) {
    return true;
  }

  return ACTIVE_SESSION_STATUS.has(session.status);
};

const compareRunRecency = (left: RunSummary, right: RunSummary): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.runId === right.runId) {
    return 0;
  }
  return left.runId > right.runId ? -1 : 1;
};

const compareTaskSessionOrder = (left: AgentSessionState, right: AgentSessionState): number => {
  const leftPresentationState = toKanbanSessionPresentationState(left);
  const rightPresentationState = toKanbanSessionPresentationState(right);

  if (leftPresentationState !== rightPresentationState) {
    return leftPresentationState === "waiting_input" ? -1 : 1;
  }

  if (left.status !== right.status) {
    if (left.status === "running") {
      return -1;
    }

    if (right.status === "running") {
      return 1;
    }

    if (left.status === "starting") {
      return -1;
    }

    if (right.status === "starting") {
      return 1;
    }
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

export const buildTaskActivityStateByTaskId = (
  tasks: TaskCard[],
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>,
): Map<string, KanbanTaskActivityState> =>
  new Map(
    tasks.map((task) => [task.id, toKanbanTaskActivityState(taskSessionsByTaskId.get(task.id))]),
  );

const getRequiredTaskActivityState = (
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>,
  taskId: string,
): KanbanTaskActivityState => {
  const taskActivityState = taskActivityStateByTaskId.get(taskId);
  if (!taskActivityState) {
    throw new Error(`Missing Kanban task activity state for task ${taskId}`);
  }

  return taskActivityState;
};

/**
 * Partitions tasks so that waiting-input tasks appear first, followed by other active tasks,
 * followed by tasks without active sessions. Uses O(N) single-pass partitioning instead of
 * O(N log N) sorting. Relative order within each partition is preserved.
 */
export const sortTasksByActivityState = (
  tasks: TaskCard[],
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>,
): TaskCard[] => {
  const waitingInputTasks: TaskCard[] = [];
  const activeTasks: TaskCard[] = [];
  const idleTasks: TaskCard[] = [];

  for (const task of tasks) {
    const activityState = getRequiredTaskActivityState(taskActivityStateByTaskId, task.id);
    if (activityState === "waiting_input") {
      waitingInputTasks.push(task);
      continue;
    }
    if (activityState === "active") {
      activeTasks.push(task);
      continue;
    }

    idleTasks.push(task);
  }

  return [...waitingInputTasks, ...activeTasks, ...idleTasks];
};

export const buildTaskSessionsByTaskId = (
  sessions: AgentSessionState[],
): Map<string, KanbanTaskSession[]> => {
  const sessionsByTaskId = new Map<string, AgentSessionState[]>();
  for (const session of sessions) {
    if (!shouldDisplayKanbanTaskSession(session)) {
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
    taskSessions.sort(compareTaskSessionOrder);
  }

  return new Map(
    Array.from(sessionsByTaskId.entries()).map(([taskId, taskSessions]) => [
      taskId,
      taskSessions.map((session) => ({
        ...(session.runtimeKind ? { runtimeKind: session.runtimeKind } : {}),
        sessionId: session.sessionId,
        role: session.role,
        scenario: session.scenario,
        status: session.status,
        presentationState: toKanbanSessionPresentationState(session),
      })),
    ]),
  );
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

  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(sessions), [sessions]);

  const taskActivityStateByTaskId = useMemo(
    () => buildTaskActivityStateByTaskId(tasks, taskSessionsByTaskId),
    [tasks, taskSessionsByTaskId],
  );

  const columnsWithSortedTasks = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        tasks: sortTasksByActivityState(col.tasks, taskActivityStateByTaskId),
      })),
    [columns, taskActivityStateByTaskId],
  );

  return {
    isLoadingTasks,
    isSwitchingWorkspace,
    columns: columnsWithSortedTasks,
    runStateByTaskId,
    taskSessionsByTaskId,
    taskActivityStateByTaskId,
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

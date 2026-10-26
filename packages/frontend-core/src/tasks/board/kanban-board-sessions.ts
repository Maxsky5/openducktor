import type { TaskCard } from "@openducktor/contracts";
import {
  type ActiveAgentSessionSummary,
  type ActiveTaskSessionContext,
  isKanbanActiveTaskSession,
  type KanbanTaskActivityState,
  type KanbanTaskSession,
  toKanbanTaskActivityState,
  toKanbanTaskSession,
} from "./kanban-task-activity";
import { compareActiveSessionForPrimary } from "./session-target-resolution";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";

const comparePrimaryTaskSession = (
  left: AgentSessionSummary,
  right: AgentSessionSummary,
): number => {
  return compareActiveSessionForPrimary(toKanbanTaskSession(left), toKanbanTaskSession(right));
};

export const buildActiveTaskSessionContextByTaskId = (
  sessions: AgentSessionSummary[],
): Map<string, ActiveTaskSessionContext> => {
  const activeTaskSessionContextByTaskId = new Map<string, ActiveAgentSessionSummary>();

  for (const session of sessions) {
    if (!isKanbanActiveTaskSession(session)) {
      continue;
    }

    const current = activeTaskSessionContextByTaskId.get(session.taskId);
    if (!current || comparePrimaryTaskSession(session, current) < 0) {
      activeTaskSessionContextByTaskId.set(session.taskId, session);
    }
  }

  return new Map(
    Array.from(activeTaskSessionContextByTaskId.entries()).map(([taskId, session]) => [
      taskId,
      {
        role: session.role,
        activityState: session.activityState,
      },
    ]),
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
  sessions: AgentSessionSummary[],
): Map<string, KanbanTaskSession[]> => {
  const sessionsByTaskId = new Map<string, AgentSessionSummary[]>();
  for (const session of sessions) {
    if (!isKanbanActiveTaskSession(session) && !session.statusUnavailableReason) {
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
    taskSessions.sort(comparePrimaryTaskSession);
  }

  return new Map(
    Array.from(sessionsByTaskId.entries()).map(([taskId, taskSessions]) => [
      taskId,
      taskSessions.map(toKanbanTaskSession),
    ]),
  );
};

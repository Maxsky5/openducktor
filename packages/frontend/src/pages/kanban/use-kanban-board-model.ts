import type {
  AgentSessionRecord,
  KanbanEmptyColumnDisplay,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { mapToKanbanColumns } from "@openducktor/core";
import { useMemo } from "react";
import {
  type ActiveAgentSessionSummary,
  type ActiveTaskSessionContext,
  isKanbanActiveTaskSession,
  type KanbanTaskActivityState,
  type KanbanTaskSession,
  toKanbanTaskActivityState,
  toKanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import {
  compareActiveSessionForPrimary,
  type SessionTargetOptions,
} from "@/components/features/kanban/session-target-resolution";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const comparePrimaryTaskSession = (
  left: ActiveAgentSessionSummary,
  right: ActiveAgentSessionSummary,
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
  const sessionsByTaskId = new Map<string, ActiveAgentSessionSummary[]>();
  for (const session of sessions) {
    if (!isKanbanActiveTaskSession(session)) {
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

type UseKanbanBoardModelArgs = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  tasks: TaskCard[];
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  sessions: AgentSessionSummary[];
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
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
  emptyColumnDisplay,
  tasks,
  historicalSessionsByTaskId,
  sessions,
  onOpenDetails,
  onDelegate,
  onOpenSession,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: UseKanbanBoardModelArgs): KanbanPageContentModel {
  const columns = useMemo(() => mapToKanbanColumns(tasks), [tasks]);

  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(sessions), [sessions]);

  const activeTaskSessionContextByTaskId = useMemo(
    () => buildActiveTaskSessionContextByTaskId(sessions),
    [sessions],
  );

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
    emptyColumnDisplay,
    columns: columnsWithSortedTasks,
    taskSessionsByTaskId,
    historicalSessionsByTaskId,
    activeTaskSessionContextByTaskId,
    taskActivityStateByTaskId,
    onOpenDetails,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanApprove,
    onHumanRequestChanges,
    onResetImplementation,
  };
}

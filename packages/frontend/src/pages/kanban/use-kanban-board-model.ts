import type { KanbanEmptyColumnDisplay, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { mapToKanbanColumns } from "@openducktor/core";
import { useMemo } from "react";
import {
  type ActiveTaskSessionContext,
  type KanbanTaskActivityState,
  type KanbanTaskSession,
  toKanbanSessionPresentationState,
  toKanbanTaskActivityState,
} from "@/components/features/kanban/kanban-task-activity";
import { compareActiveSessionForPrimary } from "@/components/features/kanban/session-target-resolution";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
  type WorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const ACTIVE_SESSION_STATUS = new Set<AgentSessionSummary["status"]>(["starting", "running"]);

const shouldDisplayKanbanTaskSession = (
  session: AgentSessionSummary,
): session is WorkflowAgentSessionSummary => {
  if (!isWorkflowAgentSessionSummary(session)) {
    return false;
  }

  if (isAgentSessionWaitingInput(session)) {
    return true;
  }

  return ACTIVE_SESSION_STATUS.has(session.status);
};

const compareTaskSessionOrder = (
  left: WorkflowAgentSessionSummary,
  right: WorkflowAgentSessionSummary,
): number => {
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

const comparePrimaryTaskSession = (
  left: WorkflowAgentSessionSummary,
  right: WorkflowAgentSessionSummary,
): number => {
  return compareActiveSessionForPrimary(
    {
      sessionId: left.sessionId,
      status: left.status,
      presentationState: toKanbanSessionPresentationState(left),
      startedAt: left.startedAt,
    },
    {
      sessionId: right.sessionId,
      status: right.status,
      presentationState: toKanbanSessionPresentationState(right),
      startedAt: right.startedAt,
    },
  );
};

export const buildActiveTaskSessionContextByTaskId = (
  sessions: AgentSessionSummary[],
): Map<string, ActiveTaskSessionContext> => {
  const activeTaskSessionContextByTaskId = new Map<string, WorkflowAgentSessionSummary>();

  for (const session of sessions) {
    if (!shouldDisplayKanbanTaskSession(session)) {
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
        presentationState: toKanbanSessionPresentationState(session),
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
  const sessionsByTaskId = new Map<string, WorkflowAgentSessionSummary[]>();
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
        startedAt: session.startedAt,
        presentationState: toKanbanSessionPresentationState(session),
      })),
    ]),
  );
};

type UseKanbanBoardModelArgs = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
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

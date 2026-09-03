import type { AgentRole, TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";

export const reconcileAgentStudioOpenTaskIds = (
  openTaskIds: readonly string[],
  tasks: readonly TaskCard[],
): string[] => {
  const knownOpenTaskIds = new Set(
    tasks.flatMap((task) => (task.status === "closed" ? [] : [task.id])),
  );
  const seenTaskIds = new Set<string>();
  return openTaskIds.filter((taskId) => {
    if (!knownOpenTaskIds.has(taskId) || seenTaskIds.has(taskId)) {
      return false;
    }
    seenTaskIds.add(taskId);
    return true;
  });
};

export const addTaskToAgentStudioState = ({
  state,
  taskId,
  tasks,
}: {
  state: WorkspaceAgentStudioState;
  taskId: string;
  tasks: readonly TaskCard[];
}): WorkspaceAgentStudioState => {
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task || task.status === "closed" || state.openTaskIds.includes(taskId)) {
    return state;
  }
  return {
    ...state,
    openTaskIds: [...state.openTaskIds, taskId],
  };
};

export const reconcileAgentStudioStateForReadModel = ({
  state,
  tasks,
  sessions,
}: {
  state: WorkspaceAgentStudioState;
  tasks: readonly TaskCard[];
  sessions: readonly AgentSessionSummary[];
}): WorkspaceAgentStudioState => {
  const openTaskIds = reconcileAgentStudioOpenTaskIds(state.openTaskIds, tasks);
  const activeTask = state.activeTask;
  const task = activeTask
    ? tasks.find((entry) => entry.id === activeTask.taskId && entry.status !== "closed")
    : undefined;
  if (!activeTask || !task) {
    return { openTaskIds };
  }

  const session = activeTask.externalSessionId
    ? sessions.find(
        (entry) =>
          entry.taskId === activeTask.taskId &&
          entry.externalSessionId === activeTask.externalSessionId,
      )
    : undefined;
  const reconciledActiveTask: NonNullable<WorkspaceAgentStudioState["activeTask"]> = {
    taskId: activeTask.taskId,
  };
  const role = session?.role ?? activeTask.role;
  if (role) {
    reconciledActiveTask.role = role;
  }
  if (session) {
    reconciledActiveTask.externalSessionId = session.externalSessionId;
  }

  return { openTaskIds, activeTask: reconciledActiveTask };
};

export const createAgentStudioStateSnapshot = ({
  openTaskIds,
  taskId,
  role,
  externalSessionId,
}: {
  openTaskIds: readonly string[];
  taskId: string;
  role: AgentRole;
  externalSessionId: string | null;
}): WorkspaceAgentStudioState => {
  if (!taskId) {
    return { openTaskIds: [...openTaskIds] };
  }

  const activeTask: NonNullable<WorkspaceAgentStudioState["activeTask"]> = {
    taskId,
    role,
  };
  if (externalSessionId) {
    activeTask.externalSessionId = externalSessionId;
  }
  return { openTaskIds: [...openTaskIds], activeTask };
};

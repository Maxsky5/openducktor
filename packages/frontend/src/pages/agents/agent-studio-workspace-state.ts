import type { AgentRole, TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";

export const pruneAgentStudioTaskIds = (
  taskIds: readonly string[],
  tasks: readonly TaskCard[],
): string[] => {
  const openIds = new Set(tasks.flatMap((task) => (task.status === "closed" ? [] : [task.id])));
  const seenIds = new Set<string>();
  return taskIds.filter((taskId) => {
    if (!openIds.has(taskId) || seenIds.has(taskId)) {
      return false;
    }
    seenIds.add(taskId);
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

export const buildAgentStudioReadState = ({
  state,
  tasks,
  sessions,
  sessionsReady,
}: {
  state: WorkspaceAgentStudioState;
  tasks: readonly TaskCard[];
  sessions: readonly AgentSessionSummary[];
  sessionsReady: boolean;
}): WorkspaceAgentStudioState => {
  const openTaskIds = pruneAgentStudioTaskIds(state.openTaskIds, tasks);
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
  const nextActiveTask: NonNullable<WorkspaceAgentStudioState["activeTask"]> = {
    taskId: activeTask.taskId,
  };
  const role = session?.role ?? activeTask.role;
  if (role) {
    nextActiveTask.role = role;
  }
  if (session) {
    nextActiveTask.externalSessionId = session.externalSessionId;
  } else if (activeTask.externalSessionId && !sessionsReady) {
    nextActiveTask.externalSessionId = activeTask.externalSessionId;
  }

  return { openTaskIds, activeTask: nextActiveTask };
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

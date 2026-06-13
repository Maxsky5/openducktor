import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useEffect, useMemo } from "react";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { isWorkflowAgentSession } from "@/state/operations/agent-orchestrator/support/session-purpose";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { AGENT_STUDIO_QUERY_KEYS, type AgentStudioQueryUpdate } from "./agent-studio-navigation";

type UseAgentStudioQuerySessionSyncArgs = {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionParam: string | null;
  selectedSessionById: AgentSessionSummary | null;
  taskId: string;
  activeSession: AgentSessionState | null;
  roleFromQuery: AgentRole;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
};

type ResolveAgentStudioQuerySessionUpdateArgs = Omit<
  UseAgentStudioQuerySessionSyncArgs,
  "scheduleQueryUpdate"
>;

const resolveAgentStudioQuerySessionUpdate = ({
  isRepoNavigationBoundaryPending,
  isLoadingTasks,
  tasks,
  taskIdParam,
  sessionParam,
  selectedSessionById,
  taskId,
  activeSession,
  roleFromQuery,
}: ResolveAgentStudioQuerySessionUpdateArgs): AgentStudioQueryUpdate | null => {
  if (isRepoNavigationBoundaryPending) {
    return null;
  }

  if (
    !isLoadingTasks &&
    taskIdParam &&
    !sessionParam &&
    !selectedSessionById &&
    !tasks.some((entry) => entry.id === taskIdParam)
  ) {
    return {
      [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
    };
  }

  const updates: AgentStudioQueryUpdate = {};

  if (selectedSessionById && !taskIdParam) {
    updates[AGENT_STUDIO_QUERY_KEYS.task] = selectedSessionById.taskId;
  }

  const selectedTaskExists = taskId.length > 0 && tasks.some((entry) => entry.id === taskId);
  const shouldClearSessionParam =
    Boolean(sessionParam) && !isLoadingTasks && selectedTaskExists && !selectedSessionById;

  if (sessionParam) {
    if (selectedSessionById && taskId && selectedSessionById.taskId !== taskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = selectedSessionById.taskId;
    } else if (shouldClearSessionParam) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = undefined;
    }
  }

  if (sessionParam && !shouldClearSessionParam && isWorkflowAgentSession(activeSession)) {
    if (taskIdParam !== activeSession.taskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = activeSession.taskId;
    }
    if (sessionParam !== activeSession.externalSessionId) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = activeSession.externalSessionId;
    }
    if (roleFromQuery !== activeSession.role) {
      updates[AGENT_STUDIO_QUERY_KEYS.agent] = activeSession.role;
    }
  }

  return Object.keys(updates).length === 0 ? null : updates;
};

export function useAgentStudioQuerySessionSync({
  isRepoNavigationBoundaryPending,
  isLoadingTasks,
  tasks,
  taskIdParam,
  sessionParam,
  selectedSessionById,
  taskId,
  activeSession,
  roleFromQuery,
  scheduleQueryUpdate,
}: UseAgentStudioQuerySessionSyncArgs): void {
  const queryUpdate = useMemo(
    () =>
      resolveAgentStudioQuerySessionUpdate({
        isRepoNavigationBoundaryPending,
        isLoadingTasks,
        tasks,
        taskIdParam,
        sessionParam,
        selectedSessionById,
        taskId,
        activeSession,
        roleFromQuery,
      }),
    [
      activeSession,
      isLoadingTasks,
      isRepoNavigationBoundaryPending,
      roleFromQuery,
      selectedSessionById,
      sessionParam,
      taskId,
      taskIdParam,
      tasks,
    ],
  );

  useEffect(() => {
    if (!queryUpdate) {
      return;
    }

    scheduleQueryUpdate(queryUpdate);
  }, [queryUpdate, scheduleQueryUpdate]);
}

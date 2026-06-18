import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useEffect, useMemo } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { WorkflowAgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_STUDIO_QUERY_KEYS, type AgentStudioQueryUpdate } from "./agent-studio-navigation";

type UseAgentStudioQuerySessionSyncArgs = {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionKeyParam: string | null;
  sessionFromQuery: WorkflowAgentSessionSummary | null;
  resolvedTaskId: string;
  resolvedSession: WorkflowAgentSessionSummary | null;
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
  sessionKeyParam,
  sessionFromQuery,
  resolvedTaskId,
  resolvedSession,
  roleFromQuery,
}: ResolveAgentStudioQuerySessionUpdateArgs): AgentStudioQueryUpdate | null => {
  if (isRepoNavigationBoundaryPending) {
    return null;
  }

  if (
    !isLoadingTasks &&
    taskIdParam &&
    !sessionKeyParam &&
    !sessionFromQuery &&
    !tasks.some((entry) => entry.id === taskIdParam)
  ) {
    return {
      [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
    };
  }

  const updates: AgentStudioQueryUpdate = {};

  if (sessionFromQuery && !taskIdParam) {
    updates[AGENT_STUDIO_QUERY_KEYS.task] = sessionFromQuery.taskId;
  }

  const selectedTaskExists =
    resolvedTaskId.length > 0 && tasks.some((entry) => entry.id === resolvedTaskId);
  const shouldClearSessionKey =
    Boolean(sessionKeyParam) && !isLoadingTasks && selectedTaskExists && !sessionFromQuery;

  if (sessionKeyParam) {
    if (sessionFromQuery && resolvedTaskId && sessionFromQuery.taskId !== resolvedTaskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = sessionFromQuery.taskId;
    } else if (shouldClearSessionKey) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = undefined;
    }
  }

  if (sessionKeyParam && !shouldClearSessionKey && resolvedSession) {
    if (taskIdParam !== resolvedSession.taskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = resolvedSession.taskId;
    }
    const resolvedSessionKey = agentSessionIdentityKey(resolvedSession);
    if (sessionKeyParam !== resolvedSessionKey) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = resolvedSessionKey;
    }
    if (roleFromQuery !== resolvedSession.role) {
      updates[AGENT_STUDIO_QUERY_KEYS.agent] = resolvedSession.role;
    }
  }

  return Object.keys(updates).length === 0 ? null : updates;
};

export function useAgentStudioQuerySessionSync({
  isRepoNavigationBoundaryPending,
  isLoadingTasks,
  tasks,
  taskIdParam,
  sessionKeyParam,
  sessionFromQuery,
  resolvedTaskId,
  resolvedSession,
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
        sessionKeyParam,
        sessionFromQuery,
        resolvedTaskId,
        resolvedSession,
        roleFromQuery,
      }),
    [
      isLoadingTasks,
      isRepoNavigationBoundaryPending,
      roleFromQuery,
      resolvedSession,
      resolvedTaskId,
      sessionFromQuery,
      sessionKeyParam,
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

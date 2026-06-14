import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useEffect, useMemo } from "react";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate,
  type AgentStudioSessionRouteParam,
  isSameAgentStudioSessionRouteParam,
  toAgentStudioSessionRouteParam,
} from "./agent-studio-navigation";

type UseAgentStudioQuerySessionSyncArgs = {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionParam: AgentStudioSessionRouteParam | null;
  sessionFromQuery: AgentSessionSummary | null;
  resolvedTaskId: string;
  resolvedSession: AgentSessionSummary | null;
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
    !sessionParam &&
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
  const shouldClearSessionParam =
    Boolean(sessionParam) && !isLoadingTasks && selectedTaskExists && !sessionFromQuery;

  if (sessionParam) {
    if (sessionFromQuery && resolvedTaskId && sessionFromQuery.taskId !== resolvedTaskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = sessionFromQuery.taskId;
    } else if (shouldClearSessionParam) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = undefined;
    }
  }

  if (sessionParam && !shouldClearSessionParam && isWorkflowAgentSessionSummary(resolvedSession)) {
    const resolvedSessionParam = toAgentStudioSessionRouteParam({
      externalSessionId: resolvedSession.externalSessionId,
      runtimeKind: resolvedSession.runtimeKind,
      workingDirectory: resolvedSession.workingDirectory,
    });
    if (taskIdParam !== resolvedSession.taskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = resolvedSession.taskId;
    }
    if (!isSameAgentStudioSessionRouteParam(sessionParam, resolvedSessionParam)) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = resolvedSession.externalSessionId;
      updates[AGENT_STUDIO_QUERY_KEYS.runtimeKind] = resolvedSession.runtimeKind;
      updates[AGENT_STUDIO_QUERY_KEYS.workingDirectory] = resolvedSession.workingDirectory;
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
  sessionParam,
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
        sessionParam,
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
      sessionParam,
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

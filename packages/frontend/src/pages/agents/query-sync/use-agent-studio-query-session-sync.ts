import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useEffect, useMemo } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentStudioRouteSessionResolution } from "../agents-page-selection";
import { AGENT_STUDIO_QUERY_KEYS, type AgentStudioQueryUpdate } from "./agent-studio-navigation";

type UseAgentStudioQuerySessionSyncArgs = {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionKeyParam: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  routeTaskId: string;
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
  sessionKeyParam,
  routeSessionResolution,
  routeTaskId,
  resolvedSession,
  roleFromQuery,
}: ResolveAgentStudioQuerySessionUpdateArgs): AgentStudioQueryUpdate | null => {
  if (isRepoNavigationBoundaryPending) {
    return null;
  }

  const sessionFromQuery =
    routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;
  const isMissingRouteSession = routeSessionResolution.kind === "missing";

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

  const routeTaskExists = routeTaskId.length > 0 && tasks.some((entry) => entry.id === routeTaskId);
  if (sessionKeyParam && isMissingRouteSession && taskIdParam && !routeTaskExists) {
    return {
      [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
    };
  }
  const shouldClearSessionKey = Boolean(sessionKeyParam) && isMissingRouteSession;

  if (sessionKeyParam) {
    if (sessionFromQuery && routeTaskId && sessionFromQuery.taskId !== routeTaskId) {
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
  routeSessionResolution,
  routeTaskId,
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
        routeSessionResolution,
        routeTaskId,
        resolvedSession,
        roleFromQuery,
      }),
    [
      isLoadingTasks,
      isRepoNavigationBoundaryPending,
      roleFromQuery,
      resolvedSession,
      routeSessionResolution,
      routeTaskId,
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

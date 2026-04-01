import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useEffect } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { AGENT_STUDIO_QUERY_KEYS, type AgentStudioQueryUpdate } from "./agent-studio-navigation";

type UseAgentStudioQuerySessionSyncArgs = {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionParam: string | null;
  selectedSessionById: AgentSessionState | null;
  taskId: string;
  activeSession: AgentSessionState | null;
  roleFromQuery: AgentRole;
  isActiveTaskHydrated: boolean;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
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
  isActiveTaskHydrated,
  scheduleQueryUpdate,
}: UseAgentStudioQuerySessionSyncArgs): void {
  useEffect(() => {
    if (isRepoNavigationBoundaryPending) {
      return;
    }
    if (isLoadingTasks) {
      return;
    }
    if (!taskIdParam || sessionParam || selectedSessionById) {
      return;
    }
    if (tasks.some((entry) => entry.id === taskIdParam)) {
      return;
    }
    scheduleQueryUpdate({
      [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.scenario]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
    });
  }, [
    isLoadingTasks,
    isRepoNavigationBoundaryPending,
    scheduleQueryUpdate,
    selectedSessionById,
    sessionParam,
    taskIdParam,
    tasks,
  ]);

  useEffect(() => {
    if (isRepoNavigationBoundaryPending) {
      return;
    }
    if (!selectedSessionById || taskIdParam) {
      return;
    }
    scheduleQueryUpdate({ [AGENT_STUDIO_QUERY_KEYS.task]: selectedSessionById.taskId });
  }, [isRepoNavigationBoundaryPending, scheduleQueryUpdate, selectedSessionById, taskIdParam]);

  useEffect(() => {
    if (isRepoNavigationBoundaryPending) {
      return;
    }
    if (!sessionParam) {
      return;
    }
    if (selectedSessionById && taskId && selectedSessionById.taskId !== taskId) {
      scheduleQueryUpdate({ [AGENT_STUDIO_QUERY_KEYS.task]: selectedSessionById.taskId });
      return;
    }
    if (!taskId || !isActiveTaskHydrated) {
      return;
    }
    if (selectedSessionById && selectedSessionById.taskId === taskId) {
      return;
    }
    scheduleQueryUpdate({ [AGENT_STUDIO_QUERY_KEYS.session]: undefined });
  }, [
    isActiveTaskHydrated,
    isRepoNavigationBoundaryPending,
    scheduleQueryUpdate,
    selectedSessionById,
    sessionParam,
    taskId,
  ]);

  useEffect(() => {
    if (isRepoNavigationBoundaryPending) {
      return;
    }
    if (!activeSession) {
      return;
    }
    if (!sessionParam) {
      return;
    }

    const updates: AgentStudioQueryUpdate = {};
    if (taskIdParam !== activeSession.taskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = activeSession.taskId;
    }
    if (sessionParam !== activeSession.sessionId) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = activeSession.sessionId;
    }
    if (roleFromQuery !== activeSession.role) {
      updates[AGENT_STUDIO_QUERY_KEYS.agent] = activeSession.role;
    }
    updates[AGENT_STUDIO_QUERY_KEYS.scenario] = undefined;

    if (Object.keys(updates).length === 0) {
      return;
    }
    scheduleQueryUpdate(updates);
  }, [
    activeSession,
    isRepoNavigationBoundaryPending,
    roleFromQuery,
    scheduleQueryUpdate,
    sessionParam,
    taskIdParam,
  ]);
}

import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useEffect } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioQuerySessionSyncArgs = {
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionParam: string | null;
  selectedSessionById: AgentSessionState | null;
  taskId: string;
  activeSession: AgentSessionState | null;
  autostart: boolean;
  roleFromQuery: AgentRole;
  scenarioFromQuery: AgentScenario | undefined;
  sessionStartPreference: "fresh" | "continue" | null;
  isActiveTaskHydrated: boolean;
  scheduleQueryUpdate: (updates: Record<string, string | undefined>) => void;
};

export function useAgentStudioQuerySessionSync({
  isLoadingTasks,
  tasks,
  taskIdParam,
  sessionParam,
  selectedSessionById,
  taskId,
  activeSession,
  autostart,
  roleFromQuery,
  scenarioFromQuery,
  sessionStartPreference,
  isActiveTaskHydrated,
  scheduleQueryUpdate,
}: UseAgentStudioQuerySessionSyncArgs): void {
  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    if (!taskIdParam || selectedSessionById) {
      return;
    }
    if (tasks.some((entry) => entry.id === taskIdParam)) {
      return;
    }
    scheduleQueryUpdate({
      task: undefined,
      session: undefined,
      agent: undefined,
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });
  }, [isLoadingTasks, scheduleQueryUpdate, selectedSessionById, taskIdParam, tasks]);

  useEffect(() => {
    if (!selectedSessionById || taskIdParam) {
      return;
    }
    scheduleQueryUpdate({ task: selectedSessionById.taskId });
  }, [scheduleQueryUpdate, selectedSessionById, taskIdParam]);

  useEffect(() => {
    if (!sessionParam) {
      return;
    }
    if (selectedSessionById && taskId && selectedSessionById.taskId !== taskId) {
      scheduleQueryUpdate({ session: undefined });
      return;
    }
    if (!taskId || !isActiveTaskHydrated) {
      return;
    }
    if (selectedSessionById && selectedSessionById.taskId === taskId) {
      return;
    }
    scheduleQueryUpdate({ session: undefined });
  }, [isActiveTaskHydrated, scheduleQueryUpdate, selectedSessionById, sessionParam, taskId]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const updates: Record<string, string | undefined> = {};
    if (taskIdParam !== activeSession.taskId) {
      updates.task = activeSession.taskId;
    }
    if (sessionParam !== activeSession.sessionId) {
      updates.session = activeSession.sessionId;
    }
    if (roleFromQuery !== activeSession.role) {
      updates.agent = activeSession.role;
    }
    if (scenarioFromQuery !== activeSession.scenario) {
      updates.scenario = activeSession.scenario;
    }
    if (autostart) {
      updates.autostart = undefined;
    }
    if (sessionStartPreference) {
      updates.start = undefined;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }
    scheduleQueryUpdate(updates);
  }, [
    activeSession,
    autostart,
    roleFromQuery,
    scheduleQueryUpdate,
    scenarioFromQuery,
    sessionParam,
    sessionStartPreference,
    taskIdParam,
  ]);
}

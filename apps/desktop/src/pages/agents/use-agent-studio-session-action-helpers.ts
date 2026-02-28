import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { isRoleAvailableForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type QueryUpdate = Record<string, string | undefined>;

export type ReusableSessionDecision = {
  session: AgentSessionState;
  clearStart: boolean;
};

export type AgentStudioSessionSelectionQueryParams = {
  taskId: string;
  sessionId: string | undefined;
  role: AgentRole;
  scenario: AgentScenario;
  clearStart?: boolean;
};

export const canStartSessionForRole = (task: TaskCard | null, role: AgentRole): boolean => {
  return !task || isRoleAvailableForTask(task, role);
};

export const resolveReusableSessionForStart = (params: {
  activeSession: AgentSessionState | null;
  sessionStartPreference: "fresh" | "continue" | null;
  sessionsForTask: AgentSessionState[];
  role: AgentRole;
}): ReusableSessionDecision | null => {
  if (params.activeSession && params.sessionStartPreference !== "fresh") {
    return {
      session: params.activeSession,
      clearStart: true,
    };
  }

  if (params.sessionStartPreference !== "continue") {
    return null;
  }

  const latestSessionForRole = params.sessionsForTask.find((entry) => entry.role === params.role);
  if (!latestSessionForRole) {
    return null;
  }

  return {
    session: latestSessionForRole,
    clearStart: false,
  };
};

export const buildSessionSelectionQueryUpdate = (params: {
  taskId: string;
  sessionId: string | undefined;
  role: AgentRole;
  scenario: AgentScenario;
  clearAutostart?: boolean;
  clearStart?: boolean;
}): QueryUpdate => {
  const update: QueryUpdate = {
    task: params.taskId,
    session: params.sessionId,
    agent: params.role,
    scenario: params.scenario,
  };

  if (params.clearAutostart) {
    update.autostart = undefined;
  }

  if (params.clearStart) {
    update.start = undefined;
  }

  return update;
};

export const buildAgentStudioSelectionQueryUpdate = (
  params: AgentStudioSessionSelectionQueryParams,
): QueryUpdate => {
  return buildSessionSelectionQueryUpdate({
    taskId: params.taskId,
    sessionId: params.sessionId,
    role: params.role,
    scenario: params.scenario,
    clearAutostart: true,
    ...(params.clearStart !== undefined ? { clearStart: params.clearStart } : {}),
  });
};

export const applyAgentStudioSelectionQuery = (
  updateQuery: (updates: QueryUpdate) => void,
  params: AgentStudioSessionSelectionQueryParams,
): void => {
  updateQuery(buildAgentStudioSelectionQueryUpdate(params));
};

export const buildFreshStartQueryUpdate = (params: {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
}): QueryUpdate => {
  return {
    task: params.taskId,
    session: undefined,
    agent: params.role,
    scenario: params.scenario,
    autostart: undefined,
    start: "fresh",
  };
};

export const buildPreviousSelectionQueryUpdate = (params: {
  activeSession: AgentSessionState | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
}): QueryUpdate => {
  return {
    task: params.activeSession?.taskId ?? params.taskId,
    session: params.activeSession?.sessionId,
    agent: params.role,
    scenario: params.scenario,
    autostart: undefined,
    start: undefined,
  };
};

export const shouldTriggerContextSwitchIntent = (params: {
  currentSessionId: string | null;
  currentRole: AgentRole;
  nextSessionId: string | null;
  nextRole: AgentRole;
}): boolean => {
  return params.currentSessionId !== params.nextSessionId || params.currentRole !== params.nextRole;
};

export const buildCreateSessionStartKey = (params: {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
}): string => {
  return `${params.taskId}:${params.role}:${params.scenario}`;
};

export const buildAutoStartKey = (params: {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
}): string | null => {
  if (!params.activeRepo || !params.taskId) {
    return null;
  }

  return `${params.activeRepo}:${params.taskId}:${params.role}:${params.scenario}`;
};

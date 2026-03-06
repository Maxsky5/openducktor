import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { isRoleAvailableForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "./agent-studio-navigation";

export type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";

export type ReusableSessionDecision = {
  session: AgentSessionState;
};

export type AgentStudioSessionSelectionQueryParams = {
  taskId: string;
  sessionId: string | undefined;
  role: AgentRole;
};

export const canStartSessionForRole = (task: TaskCard | null, role: AgentRole): boolean => {
  return !task || isRoleAvailableForTask(task, role);
};

export const resolveReusableSessionForStart = (params: {
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionState[];
  role: AgentRole;
}): ReusableSessionDecision | null => {
  if (params.activeSession) {
    return {
      session: params.activeSession,
    };
  }

  return null;
};

export const buildSessionSelectionQueryUpdate = (params: {
  taskId: string;
  sessionId: string | undefined;
  role: AgentRole;
}): QueryUpdate => {
  return {
    [AGENT_STUDIO_QUERY_KEYS.task]: params.taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: params.sessionId,
    [AGENT_STUDIO_QUERY_KEYS.agent]: params.role,
    [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
  };
};

export const buildAgentStudioSelectionQueryUpdate = (
  params: AgentStudioSessionSelectionQueryParams,
): QueryUpdate => {
  return buildSessionSelectionQueryUpdate({
    taskId: params.taskId,
    sessionId: params.sessionId,
    role: params.role,
  });
};

export const applyAgentStudioSelectionQuery = (
  updateQuery: (updates: QueryUpdate) => void,
  params: AgentStudioSessionSelectionQueryParams,
): void => {
  updateQuery(buildAgentStudioSelectionQueryUpdate(params));
};

export const buildPreviousSelectionQueryUpdate = (params: {
  activeSession: AgentSessionState | null;
  taskId: string;
  role: AgentRole;
}): QueryUpdate => {
  return {
    [AGENT_STUDIO_QUERY_KEYS.task]: params.activeSession?.taskId ?? params.taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: params.activeSession?.sessionId,
    [AGENT_STUDIO_QUERY_KEYS.agent]: params.role,
    [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
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

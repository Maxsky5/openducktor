import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { isRoleAvailableForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "./agent-studio-navigation";

export type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";

type ReusableSessionDecision = {
  session: AgentSessionState;
};

type AgentStudioSessionSelectionQueryParams = {
  taskId: string;
  sessionId: string | undefined;
  role: AgentRole;
  scenario?: AgentScenario;
};

type AgentStudioAsyncActivityContextKeyParams = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  sessionId: string | null | undefined;
};

export const canStartSessionForRole = (task: TaskCard | null, role: AgentRole): boolean => {
  return !task || isRoleAvailableForTask(task, role);
};

export const resolveReusableSessionForStart = (params: {
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  role: AgentRole;
}): ReusableSessionDecision | null => {
  if (params.activeSession) {
    return {
      session: params.activeSession,
    };
  }

  return null;
};

const buildSessionSelectionQueryUpdate = (params: {
  taskId: string;
  sessionId: string | undefined;
  role: AgentRole;
  scenario?: AgentScenario;
}): QueryUpdate => {
  const scenario = params.sessionId ? undefined : params.scenario;
  return {
    [AGENT_STUDIO_QUERY_KEYS.task]: params.taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: params.sessionId,
    [AGENT_STUDIO_QUERY_KEYS.agent]: params.role,
    [AGENT_STUDIO_QUERY_KEYS.scenario]: scenario,
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
    ...(params.scenario ? { scenario: params.scenario } : {}),
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
    [AGENT_STUDIO_QUERY_KEYS.scenario]: undefined,
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

export const buildAgentStudioAsyncActivityContextKey = (
  params: AgentStudioAsyncActivityContextKeyParams,
): string => {
  const sessionId = params.sessionId ?? "__draft__";
  return `${params.activeRepo ?? ""}:${params.taskId}:${params.role}:${sessionId}`;
};

export const incrementActivityCountRecord = (
  current: Record<string, number>,
  key: string,
): Record<string, number> => {
  return {
    ...current,
    [key]: (current[key] ?? 0) + 1,
  };
};

export const decrementActivityCountRecord = (
  current: Record<string, number>,
  key: string,
): Record<string, number> => {
  const currentCount = current[key];
  if (!currentCount) {
    return current;
  }

  if (currentCount === 1) {
    const next = { ...current };
    delete next[key];
    return next;
  }

  return {
    ...current,
    [key]: currentCount - 1,
  };
};

export const buildCreateSessionStartKey = (params: {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
}): string => {
  return `${params.taskId}:${params.role}:${params.scenario}`;
};

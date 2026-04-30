import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { isRoleAvailableForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "./agent-studio-navigation";

export type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";

type AgentStudioSessionSelectionQueryParams = {
  taskId: string;
  externalSessionId: string | undefined;
  role: AgentRole;
  scenario?: AgentScenario;
};

type AgentStudioAsyncActivityContextKeyParams = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  role: AgentRole;
  externalSessionId: string | null | undefined;
};

export const canStartSessionForRole = (task: TaskCard | null, role: AgentRole): boolean => {
  return !task || isRoleAvailableForTask(task, role);
};

const buildSessionSelectionQueryUpdate = (params: {
  taskId: string;
  externalSessionId: string | undefined;
  role: AgentRole;
  scenario?: AgentScenario;
}): QueryUpdate => {
  const scenario = params.externalSessionId ? undefined : params.scenario;
  return {
    [AGENT_STUDIO_QUERY_KEYS.task]: params.taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: params.externalSessionId,
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
    externalSessionId: params.externalSessionId,
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
    [AGENT_STUDIO_QUERY_KEYS.session]: params.activeSession?.externalSessionId,
    [AGENT_STUDIO_QUERY_KEYS.agent]: params.role,
    [AGENT_STUDIO_QUERY_KEYS.scenario]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
  };
};

export const shouldTriggerContextSwitchIntent = (params: {
  currentExternalSessionId: string | null;
  currentRole: AgentRole;
  nextSessionId: string | null;
  nextRole: AgentRole;
}): boolean => {
  return (
    params.currentExternalSessionId !== params.nextSessionId ||
    params.currentRole !== params.nextRole
  );
};

export const buildAgentStudioAsyncActivityContextKey = (
  params: AgentStudioAsyncActivityContextKeyParams,
): string => {
  const externalSessionId = params.externalSessionId ?? "__draft__";
  return `${params.activeWorkspace?.workspaceId ?? ""}:${params.taskId}:${params.role}:${externalSessionId}`;
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

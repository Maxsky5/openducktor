import { agentRoleValues, type WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";

const AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";

export const AGENT_STUDIO_QUERY_KEYS = {
  task: "task",
  session: "session",
  agent: "agent",
} as const;

const LEGACY_AGENT_STUDIO_QUERY_KEYS = [
  "autostart",
  "start",
  "runtimeKind",
  "workingDirectory",
] as const;

const AGENT_STUDIO_MANAGED_URL_QUERY_KEYS = [
  AGENT_STUDIO_QUERY_KEYS.task,
  AGENT_STUDIO_QUERY_KEYS.session,
  AGENT_STUDIO_QUERY_KEYS.agent,
  ...LEGACY_AGENT_STUDIO_QUERY_KEYS,
] as const;

export type AgentStudioQueryKey =
  (typeof AGENT_STUDIO_QUERY_KEYS)[keyof typeof AGENT_STUDIO_QUERY_KEYS];

export type AgentStudioQueryUpdate = Partial<Record<AgentStudioQueryKey, string | undefined>>;

export type AgentStudioNavigationState = {
  taskId: string;
  sessionExternalId: string | null;
  role: AgentRole | null;
};

type AgentStudioSessionSelectionQueryParams = {
  taskId: string;
  sessionExternalId: string | null;
  role: AgentRole;
};

const AGENT_ROLE_SET = new Set<string>(agentRoleValues);

const isRole = (value: string | null): value is AgentRole =>
  value != null && AGENT_ROLE_SET.has(value);

const readOptionalString = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseNavigationStateFromSearchParams = (
  searchParams: URLSearchParams,
): AgentStudioNavigationState => {
  const roleValue = readOptionalString(searchParams.get(AGENT_STUDIO_QUERY_KEYS.agent)) ?? null;

  return {
    taskId: readOptionalString(searchParams.get(AGENT_STUDIO_QUERY_KEYS.task)) ?? "",
    sessionExternalId:
      readOptionalString(searchParams.get(AGENT_STUDIO_QUERY_KEYS.session)) ?? null,
    role: isRole(roleValue) ? roleValue : null,
  };
};

export const buildSearchParamsFromNavigationState = (
  searchParams: URLSearchParams,
  navigation: AgentStudioNavigationState,
): URLSearchParams => {
  const next = new URLSearchParams(searchParams);

  for (const key of AGENT_STUDIO_MANAGED_URL_QUERY_KEYS) {
    next.delete(key);
  }

  if (navigation.taskId) {
    next.set(AGENT_STUDIO_QUERY_KEYS.task, navigation.taskId);
  }
  if (navigation.sessionExternalId) {
    next.set(AGENT_STUDIO_QUERY_KEYS.session, navigation.sessionExternalId);
  }
  if (navigation.role) {
    next.set(AGENT_STUDIO_QUERY_KEYS.agent, navigation.role);
  }

  return next;
};

export const applyQueryUpdateToNavigationState = (
  current: AgentStudioNavigationState,
  updates: AgentStudioQueryUpdate,
): AgentStudioNavigationState => {
  const next = { ...current };
  let hasChanged = false;

  if (AGENT_STUDIO_QUERY_KEYS.task in updates) {
    const taskId = readOptionalString(updates.task) ?? "";
    if (taskId !== next.taskId) {
      next.taskId = taskId;
      hasChanged = true;
    }
  }

  if (AGENT_STUDIO_QUERY_KEYS.session in updates) {
    const sessionExternalId = readOptionalString(updates.session) ?? null;
    if (sessionExternalId !== next.sessionExternalId) {
      next.sessionExternalId = sessionExternalId;
      hasChanged = true;
    }
  }

  if (AGENT_STUDIO_QUERY_KEYS.agent in updates) {
    const roleValue = readOptionalString(updates.agent) ?? null;
    const role = isRole(roleValue) ? roleValue : null;
    if (role !== next.role) {
      next.role = role;
      hasChanged = true;
    }
  }

  return hasChanged ? next : current;
};

export const buildAgentStudioSelectionQueryUpdate = (
  params: AgentStudioSessionSelectionQueryParams,
) =>
  ({
    [AGENT_STUDIO_QUERY_KEYS.task]: params.taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: params.sessionExternalId ?? undefined,
    [AGENT_STUDIO_QUERY_KEYS.agent]: params.role,
  }) satisfies AgentStudioQueryUpdate;

export const buildAgentStudioHref = (params: AgentStudioSessionSelectionQueryParams): string => {
  const searchParams = buildSearchParamsFromNavigationState(new URLSearchParams(), {
    taskId: params.taskId,
    sessionExternalId: params.sessionExternalId,
    role: params.role,
  });
  return `/agents?${searchParams.toString()}`;
};

export const isSameNavigationState = (
  left: AgentStudioNavigationState,
  right: AgentStudioNavigationState,
): boolean => {
  return (
    left.taskId === right.taskId &&
    left.sessionExternalId === right.sessionExternalId &&
    left.role === right.role
  );
};

export const clearAgentStudioNavigationState = (
  current: AgentStudioNavigationState,
): AgentStudioNavigationState => {
  return {
    ...current,
    taskId: "",
    sessionExternalId: null,
    role: null,
  };
};

export const hasAgentStudioNavigationSelection = (
  navigation: AgentStudioNavigationState,
): boolean => {
  return Boolean(navigation.taskId || navigation.sessionExternalId || navigation.role);
};

export const restoreNavigationFromWorkspaceState = (
  current: AgentStudioNavigationState,
  state: WorkspaceAgentStudioState,
): AgentStudioNavigationState => {
  const activeTask = state.activeTask;
  const role = current.role ?? activeTask?.role ?? null;
  const taskId = current.taskId || activeTask?.taskId || "";
  const sessionExternalId =
    current.sessionExternalId ??
    (!current.taskId || activeTask?.taskId === current.taskId
      ? (activeTask?.externalSessionId ?? null)
      : null);

  return {
    ...current,
    taskId,
    sessionExternalId,
    role,
  };
};

export const toRightPanelStorageKey = (): string => AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY;

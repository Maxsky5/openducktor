import { type AgentRole, isRecord } from "@openducktor/core";
import { isRole } from "./agents-page-constants";

const AGENT_STUDIO_CONTEXT_STORAGE_PREFIX = "openducktor:agent-studio:context";
const AGENT_STUDIO_TABS_STORAGE_PREFIX = "openducktor:agent-studio:tabs";
const AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";

export const AGENT_STUDIO_QUERY_KEYS = {
  task: "task",
  session: "session",
  agent: "agent",
  scenario: "scenario",
  autostart: "autostart",
  start: "start",
} as const;

export const AGENT_STUDIO_MANAGED_URL_QUERY_KEYS = [
  AGENT_STUDIO_QUERY_KEYS.task,
  AGENT_STUDIO_QUERY_KEYS.session,
  AGENT_STUDIO_QUERY_KEYS.agent,
  AGENT_STUDIO_QUERY_KEYS.autostart,
  AGENT_STUDIO_QUERY_KEYS.start,
] as const;

export const AGENT_STUDIO_PERSISTED_CONTEXT_KEYS = {
  taskId: "taskId",
  role: "role",
  sessionId: "sessionId",
} as const;

export type AgentStudioQueryKey =
  (typeof AGENT_STUDIO_QUERY_KEYS)[keyof typeof AGENT_STUDIO_QUERY_KEYS];

export type AgentStudioQueryUpdate = Partial<Record<AgentStudioQueryKey, string | undefined>>;

export type AgentStudioNavigationState = {
  taskId: string;
  sessionId: string | null;
  role: AgentRole | null;
};

export type PersistedAgentStudioContext = {
  taskId?: string;
  role?: AgentRole;
  sessionId?: string;
};

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
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
    sessionId: readOptionalString(searchParams.get(AGENT_STUDIO_QUERY_KEYS.session)) ?? null,
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
  if (navigation.sessionId) {
    next.set(AGENT_STUDIO_QUERY_KEYS.session, navigation.sessionId);
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
  let next = current;

  for (const [key, value] of Object.entries(updates)) {
    if (key === AGENT_STUDIO_QUERY_KEYS.task) {
      const taskId = readOptionalString(value) ?? "";
      if (taskId !== next.taskId) {
        next = { ...next, taskId };
      }
      continue;
    }

    if (key === AGENT_STUDIO_QUERY_KEYS.session) {
      const sessionId = readOptionalString(value) ?? null;
      if (sessionId !== next.sessionId) {
        next = { ...next, sessionId };
      }
      continue;
    }

    if (key === AGENT_STUDIO_QUERY_KEYS.agent) {
      const roleValue = readOptionalString(value) ?? null;
      const role = isRole(roleValue) ? roleValue : null;
      if (role !== next.role) {
        next = { ...next, role };
      }
    }
  }

  return next;
};

export const isSameNavigationState = (
  left: AgentStudioNavigationState,
  right: AgentStudioNavigationState,
): boolean => {
  return (
    left.taskId === right.taskId && left.sessionId === right.sessionId && left.role === right.role
  );
};

export const parsePersistedContext = (raw: string): PersistedAgentStudioContext | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const taskId = readOptionalString(parsed[AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.taskId]);
  const roleValue = readOptionalString(parsed[AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.role]) ?? null;
  const role = isRole(roleValue) ? roleValue : undefined;
  const sessionId = readOptionalString(parsed[AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.sessionId]);

  return {
    ...(taskId ? { taskId } : {}),
    ...(role ? { role } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
};

export const restoreNavigationFromPersistedContext = (
  current: AgentStudioNavigationState,
  persisted: PersistedAgentStudioContext,
): AgentStudioNavigationState => {
  const role = current.role ?? persisted.role ?? null;

  return {
    ...current,
    taskId: current.taskId || persisted.taskId || "",
    sessionId: current.sessionId ?? persisted.sessionId ?? null,
    role,
  };
};

export const serializePersistedContext = (navigation: AgentStudioNavigationState): string => {
  const roleForContext = navigation.role ?? "spec";
  const payload = {
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.taskId]: navigation.taskId || undefined,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.role]: roleForContext,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.sessionId]: navigation.sessionId || undefined,
  };

  return JSON.stringify(payload);
};

export const toContextStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_CONTEXT_STORAGE_PREFIX}:${repoPath}`;

export const toTabsStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_TABS_STORAGE_PREFIX}:${repoPath}`;

export const toRightPanelStorageKey = (): string => AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY;

import { agentRoleValues } from "@openducktor/contracts";
import { type AgentRole, isRecord } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";

const AGENT_STUDIO_CONTEXT_STORAGE_PREFIX = "openducktor:agent-studio:context";
const AGENT_STUDIO_TABS_STORAGE_PREFIX = "openducktor:agent-studio:tabs";
const AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";

export const AGENT_STUDIO_QUERY_KEYS = {
  task: "task",
  session: "session",
  agent: "agent",
} as const;

const LEGACY_AGENT_STUDIO_QUERY_KEYS = ["autostart", "start"] as const;

const AGENT_STUDIO_MANAGED_URL_QUERY_KEYS = [
  AGENT_STUDIO_QUERY_KEYS.task,
  AGENT_STUDIO_QUERY_KEYS.session,
  AGENT_STUDIO_QUERY_KEYS.agent,
  ...LEGACY_AGENT_STUDIO_QUERY_KEYS,
] as const;

const AGENT_STUDIO_PERSISTED_CONTEXT_KEYS = {
  taskId: "taskId",
  role: "role",
  externalSessionId: "externalSessionId",
} as const;

export type AgentStudioQueryKey =
  (typeof AGENT_STUDIO_QUERY_KEYS)[keyof typeof AGENT_STUDIO_QUERY_KEYS];

export type AgentStudioQueryUpdate = Partial<Record<AgentStudioQueryKey, string | undefined>>;

export type AgentStudioNavigationState = {
  taskId: string;
  externalSessionId: string | null;
  role: AgentRole | null;
};

export type PersistedAgentStudioContext = {
  taskId?: string;
  role?: AgentRole;
  externalSessionId?: string;
};

const AGENT_ROLE_SET = new Set<string>(agentRoleValues);

const isRole = (value: string | null): value is AgentRole =>
  value != null && AGENT_ROLE_SET.has(value);

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
    externalSessionId:
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
  if (navigation.externalSessionId) {
    next.set(AGENT_STUDIO_QUERY_KEYS.session, navigation.externalSessionId);
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
    const externalSessionId = readOptionalString(updates.session) ?? null;
    if (externalSessionId !== next.externalSessionId) {
      next.externalSessionId = externalSessionId;
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

export const isSameNavigationState = (
  left: AgentStudioNavigationState,
  right: AgentStudioNavigationState,
): boolean => {
  return (
    left.taskId === right.taskId &&
    left.externalSessionId === right.externalSessionId &&
    left.role === right.role
  );
};

export const clearAgentStudioNavigationState = (
  current: AgentStudioNavigationState,
): AgentStudioNavigationState => {
  return {
    ...current,
    taskId: "",
    externalSessionId: null,
    role: null,
  };
};

export const hasAgentStudioNavigationSelection = (
  navigation: AgentStudioNavigationState,
): boolean => {
  return Boolean(navigation.taskId || navigation.externalSessionId || navigation.role);
};

export const parsePersistedContext = (raw: string): PersistedAgentStudioContext => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Failed to parse persisted agent studio context: ${errorMessage(cause)}`, {
      cause,
    });
  }

  if (!isRecord(parsed)) {
    throw new Error("Failed to parse persisted agent studio context: expected an object payload.");
  }

  const taskId = parsePersistedContextString(parsed, AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.taskId);
  const roleValue = parsePersistedContextString(parsed, AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.role);
  const role: AgentRole | undefined = roleValue
    ? (() => {
        if (!isRole(roleValue)) {
          throw new Error(
            `Failed to parse persisted agent studio context: invalid role "${roleValue}".`,
          );
        }
        return roleValue;
      })()
    : undefined;
  const externalSessionId = parsePersistedContextString(
    parsed,
    AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.externalSessionId,
  );
  return {
    ...(taskId ? { taskId } : {}),
    ...(role ? { role } : {}),
    ...(externalSessionId ? { externalSessionId } : {}),
  };
};

export const restoreNavigationFromPersistedContext = (
  current: AgentStudioNavigationState,
  persisted: PersistedAgentStudioContext,
): AgentStudioNavigationState => {
  const role = current.role ?? persisted.role ?? null;
  const taskId = current.taskId || persisted.taskId || "";
  const externalSessionId =
    current.externalSessionId ??
    (!current.taskId || persisted.taskId === current.taskId
      ? (persisted.externalSessionId ?? null)
      : null);

  return {
    ...current,
    taskId,
    externalSessionId,
    role,
  };
};

export const serializePersistedContext = (navigation: AgentStudioNavigationState): string => {
  const payload = {
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.taskId]: navigation.taskId || undefined,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.role]: navigation.role ?? undefined,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.externalSessionId]:
      navigation.externalSessionId || undefined,
  };

  return JSON.stringify(payload);
};

export const toContextStorageKey = (workspaceId: string): string =>
  `${AGENT_STUDIO_CONTEXT_STORAGE_PREFIX}:${workspaceId}`;

export const toTabsStorageKey = (workspaceId: string): string =>
  `${AGENT_STUDIO_TABS_STORAGE_PREFIX}:${workspaceId}`;

export const toRightPanelStorageKey = (): string => AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY;

const parsePersistedContextString = (
  parsed: Record<string, unknown>,
  key: (typeof AGENT_STUDIO_PERSISTED_CONTEXT_KEYS)[keyof typeof AGENT_STUDIO_PERSISTED_CONTEXT_KEYS],
): string | undefined => {
  const value = parsed[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(
      `Failed to parse persisted agent studio context: field "${key}" must be a string.`,
    );
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

import { agentRoleValues, type WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import {
  parseTaskSessionIdentity,
  TASK_SESSION_QUERY_KEYS,
  toTaskSessionIdentity,
} from "@/features/session-navigation/session-navigation-target";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

const AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";

export const AGENT_STUDIO_QUERY_KEYS = TASK_SESSION_QUERY_KEYS;

const LEGACY_AGENT_STUDIO_QUERY_KEYS = ["autostart", "start"] as const;

const AGENT_STUDIO_MANAGED_URL_QUERY_KEYS = [
  ...Object.values(AGENT_STUDIO_QUERY_KEYS),
  ...LEGACY_AGENT_STUDIO_QUERY_KEYS,
];

export type AgentStudioQueryKey =
  (typeof AGENT_STUDIO_QUERY_KEYS)[keyof typeof AGENT_STUDIO_QUERY_KEYS];

/** A change of address values. A `session` change replaces the session identity values too. */
export type AgentStudioQueryUpdate = Partial<Record<AgentStudioQueryKey, string | undefined>>;

export type AgentStudioNavigationState = {
  taskId: string;
  sessionExternalId: string | null;
  /** The complete identity of the session, when the address names all its fields. */
  sessionIdentity: AgentSessionIdentity | null;
  role: AgentRole | null;
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
    sessionIdentity: parseTaskSessionIdentity(searchParams),
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
  if (navigation.sessionIdentity) {
    next.set(AGENT_STUDIO_QUERY_KEYS.runtimeKind, navigation.sessionIdentity.runtimeKind);
    next.set(AGENT_STUDIO_QUERY_KEYS.workingDirectory, navigation.sessionIdentity.workingDirectory);
  }

  return next;
};

const sameSessionIdentity = (
  left: AgentSessionIdentity | null,
  right: AgentSessionIdentity | null,
): boolean =>
  left === null || right === null
    ? left === right
    : agentSessionIdentityKey(left) === agentSessionIdentityKey(right);

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
    const sessionIdentity = toTaskSessionIdentity(updates);
    if (
      sessionExternalId !== next.sessionExternalId ||
      !sameSessionIdentity(sessionIdentity, next.sessionIdentity)
    ) {
      next.sessionExternalId = sessionExternalId;
      next.sessionIdentity = sessionIdentity;
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

/** The address values of a session. Without an identity, they name the external ID only. */
export const sessionQueryUpdate = (
  sessionExternalId: string | null,
  sessionIdentity: AgentSessionIdentity | null,
) =>
  ({
    [AGENT_STUDIO_QUERY_KEYS.session]: sessionExternalId ?? undefined,
    [AGENT_STUDIO_QUERY_KEYS.runtimeKind]: sessionIdentity?.runtimeKind,
    [AGENT_STUDIO_QUERY_KEYS.workingDirectory]: sessionIdentity?.workingDirectory,
  }) satisfies AgentStudioQueryUpdate;

export const buildAgentStudioSelectionQueryUpdate = (params: {
  taskId: string;
  session: AgentSessionIdentity;
  role: AgentRole;
}) =>
  ({
    [AGENT_STUDIO_QUERY_KEYS.task]: params.taskId,
    ...sessionQueryUpdate(params.session.externalSessionId, params.session),
    [AGENT_STUDIO_QUERY_KEYS.agent]: params.role,
  }) satisfies AgentStudioQueryUpdate;

export const isSameNavigationState = (
  left: AgentStudioNavigationState,
  right: AgentStudioNavigationState,
): boolean => {
  return (
    left.taskId === right.taskId &&
    left.sessionExternalId === right.sessionExternalId &&
    sameSessionIdentity(left.sessionIdentity, right.sessionIdentity) &&
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
    sessionIdentity: null,
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

import { agentRoleValues, type RuntimeKind, runtimeKindSchema } from "@openducktor/contracts";
import { type AgentRole, isRecord } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionRouteIdentity } from "@/types/agent-orchestrator";

const AGENT_STUDIO_CONTEXT_STORAGE_PREFIX = "openducktor:agent-studio:context";
const AGENT_STUDIO_TABS_STORAGE_PREFIX = "openducktor:agent-studio:tabs";
const AGENT_STUDIO_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";

export const AGENT_STUDIO_QUERY_KEYS = {
  task: "task",
  session: "session",
  runtimeKind: "runtimeKind",
  workingDirectory: "workingDirectory",
  agent: "agent",
} as const;

const LEGACY_AGENT_STUDIO_QUERY_KEYS = ["autostart", "start"] as const;

const AGENT_STUDIO_MANAGED_URL_QUERY_KEYS = [
  AGENT_STUDIO_QUERY_KEYS.task,
  AGENT_STUDIO_QUERY_KEYS.session,
  AGENT_STUDIO_QUERY_KEYS.runtimeKind,
  AGENT_STUDIO_QUERY_KEYS.workingDirectory,
  AGENT_STUDIO_QUERY_KEYS.agent,
  ...LEGACY_AGENT_STUDIO_QUERY_KEYS,
] as const;

const AGENT_STUDIO_PERSISTED_CONTEXT_KEYS = {
  taskId: "taskId",
  role: "role",
  externalSessionId: "externalSessionId",
  runtimeKind: "runtimeKind",
  workingDirectory: "workingDirectory",
} as const;

export type AgentStudioQueryKey =
  (typeof AGENT_STUDIO_QUERY_KEYS)[keyof typeof AGENT_STUDIO_QUERY_KEYS];

export type AgentStudioQueryUpdate = Partial<Record<AgentStudioQueryKey, string | undefined>>;

export type AgentStudioSessionRouteParam =
  | {
      kind: "exact";
      identity: AgentSessionRouteIdentity;
    }
  | {
      kind: "external";
      externalSessionId: string;
    };

export type AgentStudioNavigationState = {
  taskId: string;
  session: AgentStudioSessionRouteParam | null;
  role: AgentRole | null;
};

export type PersistedAgentStudioContext = {
  taskId?: string;
  role?: AgentRole;
  session?: AgentStudioSessionRouteParam;
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

const readRuntimeKind = (value: unknown): RuntimeKind | null => {
  const runtimeKind = readOptionalString(value);
  if (!runtimeKind) {
    return null;
  }
  const parsed = runtimeKindSchema.safeParse(runtimeKind);
  return parsed.success ? parsed.data : null;
};

export const toAgentStudioSessionRouteParam = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: {
  externalSessionId: string | null | undefined;
  runtimeKind?: RuntimeKind | null | undefined;
  workingDirectory?: string | null | undefined;
}): AgentStudioSessionRouteParam | null => {
  const resolvedExternalSessionId = readOptionalString(externalSessionId) ?? null;
  if (!resolvedExternalSessionId) {
    return null;
  }

  const resolvedWorkingDirectory = readOptionalString(workingDirectory) ?? null;
  if (runtimeKind && resolvedWorkingDirectory) {
    return {
      kind: "exact",
      identity: {
        externalSessionId: resolvedExternalSessionId,
        runtimeKind,
        workingDirectory: resolvedWorkingDirectory,
      },
    };
  }

  return {
    kind: "external",
    externalSessionId: resolvedExternalSessionId,
  };
};

export const getAgentStudioSessionParamExternalSessionId = (
  session: AgentStudioSessionRouteParam | null,
): string | null => {
  if (!session) {
    return null;
  }
  return session.kind === "exact" ? session.identity.externalSessionId : session.externalSessionId;
};

export const getAgentStudioSessionParamIdentity = (
  session: AgentStudioSessionRouteParam | null,
): AgentSessionRouteIdentity | null => (session?.kind === "exact" ? session.identity : null);

export const isSameAgentStudioSessionRouteParam = (
  left: AgentStudioSessionRouteParam | null,
  right: AgentStudioSessionRouteParam | null,
): boolean => {
  if (left === null || right === null) {
    return left === right;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "external" && right.kind === "external") {
    return left.externalSessionId === right.externalSessionId;
  }
  if (left.kind === "exact" && right.kind === "exact") {
    return agentSessionIdentityKey(left.identity) === agentSessionIdentityKey(right.identity);
  }
  return false;
};

const readSessionRouteParam = (
  searchParams: URLSearchParams,
): AgentStudioSessionRouteParam | null =>
  toAgentStudioSessionRouteParam({
    externalSessionId: searchParams.get(AGENT_STUDIO_QUERY_KEYS.session),
    runtimeKind: readRuntimeKind(searchParams.get(AGENT_STUDIO_QUERY_KEYS.runtimeKind)),
    workingDirectory: searchParams.get(AGENT_STUDIO_QUERY_KEYS.workingDirectory),
  });

export const parseNavigationStateFromSearchParams = (
  searchParams: URLSearchParams,
): AgentStudioNavigationState => {
  const roleValue = readOptionalString(searchParams.get(AGENT_STUDIO_QUERY_KEYS.agent)) ?? null;

  return {
    taskId: readOptionalString(searchParams.get(AGENT_STUDIO_QUERY_KEYS.task)) ?? "",
    session: readSessionRouteParam(searchParams),
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
  if (navigation.session) {
    next.set(
      AGENT_STUDIO_QUERY_KEYS.session,
      getAgentStudioSessionParamExternalSessionId(navigation.session) ?? "",
    );
    if (navigation.session.kind === "exact") {
      next.set(AGENT_STUDIO_QUERY_KEYS.runtimeKind, navigation.session.identity.runtimeKind);
      next.set(
        AGENT_STUDIO_QUERY_KEYS.workingDirectory,
        navigation.session.identity.workingDirectory,
      );
    }
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
    const session = toAgentStudioSessionRouteParam({
      externalSessionId: updates.session,
      runtimeKind: readRuntimeKind(updates.runtimeKind),
      workingDirectory: updates.workingDirectory,
    });
    if (!isSameAgentStudioSessionRouteParam(session, next.session)) {
      next.session = session;
      hasChanged = true;
    }
  } else if (
    AGENT_STUDIO_QUERY_KEYS.runtimeKind in updates ||
    AGENT_STUDIO_QUERY_KEYS.workingDirectory in updates
  ) {
    const currentIdentity = getAgentStudioSessionParamIdentity(next.session);
    const session = toAgentStudioSessionRouteParam({
      externalSessionId: getAgentStudioSessionParamExternalSessionId(next.session),
      runtimeKind:
        AGENT_STUDIO_QUERY_KEYS.runtimeKind in updates
          ? readRuntimeKind(updates.runtimeKind)
          : currentIdentity?.runtimeKind,
      workingDirectory:
        AGENT_STUDIO_QUERY_KEYS.workingDirectory in updates
          ? updates.workingDirectory
          : currentIdentity?.workingDirectory,
    });
    if (!isSameAgentStudioSessionRouteParam(session, next.session)) {
      next.session = session;
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
    isSameAgentStudioSessionRouteParam(left.session, right.session) &&
    left.role === right.role
  );
};

export const clearAgentStudioNavigationState = (
  current: AgentStudioNavigationState,
): AgentStudioNavigationState => {
  return {
    ...current,
    taskId: "",
    session: null,
    role: null,
  };
};

export const hasAgentStudioNavigationSelection = (
  navigation: AgentStudioNavigationState,
): boolean => {
  return Boolean(navigation.taskId || navigation.session || navigation.role);
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
  const session = toAgentStudioSessionRouteParam({
    externalSessionId: parsePersistedContextString(
      parsed,
      AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.externalSessionId,
    ),
    runtimeKind: readRuntimeKind(
      parsePersistedContextString(parsed, AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.runtimeKind),
    ),
    workingDirectory: parsePersistedContextString(
      parsed,
      AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.workingDirectory,
    ),
  });
  return {
    ...(taskId ? { taskId } : {}),
    ...(role ? { role } : {}),
    ...(session ? { session } : {}),
  };
};

export const restoreNavigationFromPersistedContext = (
  current: AgentStudioNavigationState,
  persisted: PersistedAgentStudioContext,
): AgentStudioNavigationState => {
  const role = current.role ?? persisted.role ?? null;
  const taskId = current.taskId || persisted.taskId || "";
  const session =
    current.session ??
    (!current.taskId || persisted.taskId === current.taskId ? (persisted.session ?? null) : null);

  return {
    ...current,
    taskId,
    session,
    role,
  };
};

export const serializePersistedContext = (navigation: AgentStudioNavigationState): string => {
  const sessionIdentity = getAgentStudioSessionParamIdentity(navigation.session);
  const payload = {
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.taskId]: navigation.taskId || undefined,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.role]: navigation.role ?? undefined,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.externalSessionId]:
      getAgentStudioSessionParamExternalSessionId(navigation.session) || undefined,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.runtimeKind]: sessionIdentity?.runtimeKind,
    [AGENT_STUDIO_PERSISTED_CONTEXT_KEYS.workingDirectory]: sessionIdentity?.workingDirectory,
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

import { type AgentRole, runtimeKindSchema } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export const SESSIONS_PATH = "/sessions";

/** Query keys that the Sessions page owns. Each content view owns its other keys. */
export const SESSIONS_QUERY_KEYS = {
  workspace: "workspace",
  kind: "kind",
} as const;

/**
 * Keys of task content. A task session address names the complete session identity, because
 * the external session ID alone can match a session of another runtime or working directory.
 */
export const TASK_SESSION_QUERY_KEYS = {
  task: "task",
  session: "session",
  agent: "agent",
  runtimeKind: "runtimeKind",
  workingDirectory: "workingDirectory",
} as const;

export const WORKSPACE_SESSION_QUERY_KEYS = {
  session: "session",
  create: "create",
} as const;

export type SessionsPageKind = "task" | "workspace";

/**
 * A conversation or context that the Sessions page can open.
 *
 * A task session carries its complete identity, so matching titles, roles, or external IDs
 * never select another conversation. A task target without a session opens the task context
 * and never starts a session. Its optional role opens the view of that role.
 */
export type SessionNavigationTarget =
  | {
      kind: "task_session";
      workspaceId: string;
      taskId: string;
      role: AgentRole;
      identity: AgentSessionIdentity;
    }
  | { kind: "task"; workspaceId: string; taskId: string; role: AgentRole | null }
  | { kind: "workspace_session"; workspaceId: string; sessionId: string };

/**
 * One key for a sidebar entry and for the content on screen, so that selection compares one
 * format. A task context has one key for all its roles.
 */
export const sessionNavigationTargetKey = (target: SessionNavigationTarget): string => {
  if (target.kind === "task_session") {
    return `task_session:${target.workspaceId}:${agentSessionIdentityKey(target.identity)}`;
  }
  if (target.kind === "task") return `task:${target.workspaceId}:${target.taskId}`;
  return `workspace_session:${target.workspaceId}:${target.sessionId}`;
};

export const parseSessionsPageKind = (value: string | null): SessionsPageKind | null =>
  value === "task" || value === "workspace" ? value : null;

const pageSearchParams = (workspaceId: string, kind: SessionsPageKind | null): URLSearchParams => {
  const params = new URLSearchParams();
  params.set(SESSIONS_QUERY_KEYS.workspace, workspaceId);
  if (kind) params.set(SESSIONS_QUERY_KEYS.kind, kind);
  return params;
};

/** A Sessions page for one workspace and content kind, with no explicit selection. */
export const buildSessionsPageHref = (workspaceId: string, kind: SessionsPageKind | null): string =>
  `${SESSIONS_PATH}?${pageSearchParams(workspaceId, kind).toString()}`;

/** The workspace session content opens its create dialog for this address. */
export const buildNewWorkspaceSessionHref = (workspaceId: string): string => {
  const params = pageSearchParams(workspaceId, "workspace");
  params.set(WORKSPACE_SESSION_QUERY_KEYS.create, "session");
  return `${SESSIONS_PATH}?${params.toString()}`;
};

export const buildSessionNavigationHref = (target: SessionNavigationTarget): string => {
  if (target.kind === "workspace_session") {
    const params = pageSearchParams(target.workspaceId, "workspace");
    params.set(WORKSPACE_SESSION_QUERY_KEYS.session, target.sessionId);
    return `${SESSIONS_PATH}?${params.toString()}`;
  }
  const params = pageSearchParams(target.workspaceId, "task");
  params.set(TASK_SESSION_QUERY_KEYS.task, target.taskId);
  if (target.kind === "task_session") {
    params.set(TASK_SESSION_QUERY_KEYS.session, target.identity.externalSessionId);
    params.set(TASK_SESSION_QUERY_KEYS.agent, target.role);
    params.set(TASK_SESSION_QUERY_KEYS.runtimeKind, target.identity.runtimeKind);
    params.set(TASK_SESSION_QUERY_KEYS.workingDirectory, target.identity.workingDirectory);
  } else if (target.role) {
    params.set(TASK_SESSION_QUERY_KEYS.agent, target.role);
  }
  return `${SESSIONS_PATH}?${params.toString()}`;
};

type TaskSessionAddressValues = {
  session?: string | null | undefined;
  runtimeKind?: string | null | undefined;
  workingDirectory?: string | null | undefined;
};

const readValue = (value: string | null | undefined): string | null => value?.trim() || null;

/** The complete task session identity of address values, or null when a value is missing. */
export const toTaskSessionIdentity = (
  values: TaskSessionAddressValues,
): AgentSessionIdentity | null => {
  const externalSessionId = readValue(values.session);
  const runtimeKind = runtimeKindSchema.safeParse(readValue(values.runtimeKind));
  const workingDirectory = readValue(values.workingDirectory);
  if (!externalSessionId || !runtimeKind.success || !workingDirectory) return null;
  return { externalSessionId, runtimeKind: runtimeKind.data, workingDirectory };
};

/** The complete task session identity of an address, or null when the address lacks a field. */
export const parseTaskSessionIdentity = (
  searchParams: URLSearchParams,
): AgentSessionIdentity | null =>
  toTaskSessionIdentity({
    session: searchParams.get(TASK_SESSION_QUERY_KEYS.session),
    runtimeKind: searchParams.get(TASK_SESSION_QUERY_KEYS.runtimeKind),
    workingDirectory: searchParams.get(TASK_SESSION_QUERY_KEYS.workingDirectory),
  });

/**
 * Map an old page address to the Sessions page.
 *
 * The old task and workspace pages both used `session` with different meanings, so the kind
 * keeps each old link on the content that understands its parameters.
 */
export const legacySessionsSearch = (search: string, kind: SessionsPageKind): string => {
  const params = new URLSearchParams(search);
  params.set(SESSIONS_QUERY_KEYS.kind, kind);
  return `?${params.toString()}`;
};

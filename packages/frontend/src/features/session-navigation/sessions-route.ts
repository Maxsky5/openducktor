import type { SessionNavigationTarget } from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";

/** The route of the desktop Sessions page. Its query keys name the target that it opens. */
export const SESSIONS_PATH = "/sessions";

/** Query keys that the Sessions page owns. Each content view owns its other keys. */
export const SESSIONS_QUERY_KEYS = {
  workspace: "workspace",
  kind: "kind",
} as const;

export const TASK_SESSION_QUERY_KEYS = {
  task: "task",
  session: "session",
  agent: "agent",
} as const;

export const WORKSPACE_SESSION_QUERY_KEYS = {
  session: "session",
  create: "create",
} as const;

export type SessionsPageKind = "task" | "workspace";

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

/** The search part of the Sessions address that opens the target. */
export const buildSessionNavigationSearch = (target: SessionNavigationTarget): string => {
  if (target.kind === "workspace_session") {
    const params = pageSearchParams(target.workspaceId, "workspace");
    params.set(WORKSPACE_SESSION_QUERY_KEYS.session, target.sessionId);
    return `?${params.toString()}`;
  }
  const params = pageSearchParams(target.workspaceId, "task");
  params.set(TASK_SESSION_QUERY_KEYS.task, target.taskId);
  if (target.kind === "task_session") {
    params.set(TASK_SESSION_QUERY_KEYS.session, target.identity.externalSessionId);
    params.set(TASK_SESSION_QUERY_KEYS.agent, target.role);
  } else if (target.role) {
    params.set(TASK_SESSION_QUERY_KEYS.agent, target.role);
  }
  return `?${params.toString()}`;
};

export const buildSessionNavigationHref = (target: SessionNavigationTarget): string =>
  `${SESSIONS_PATH}${buildSessionNavigationSearch(target)}`;

/** The query keys that name the task, the session, and the role that an address selects. */
export const SESSION_SELECTION_KEYS = [
  TASK_SESSION_QUERY_KEYS.task,
  TASK_SESSION_QUERY_KEYS.session,
  TASK_SESSION_QUERY_KEYS.agent,
] as const;

/** Two Sessions address searches select the same task, session, and role. */
export const sameSessionSelection = (left: string, right: string): boolean => {
  const leftParams = new URLSearchParams(left);
  const rightParams = new URLSearchParams(right);
  return SESSION_SELECTION_KEYS.every((key) => leftParams.get(key) === rightParams.get(key));
};

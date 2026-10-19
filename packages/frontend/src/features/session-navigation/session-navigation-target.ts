import type { AgentRole } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

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

/**
 * A conversation or context that the Sessions page can open.
 *
 * A task session uses its native ID within the workspace and task. A task target without a
 * session opens the task context and never starts a session. Its optional role opens the view
 * of that role.
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
  } else if (target.role) {
    params.set(TASK_SESSION_QUERY_KEYS.agent, target.role);
  }
  return `${SESSIONS_PATH}?${params.toString()}`;
};

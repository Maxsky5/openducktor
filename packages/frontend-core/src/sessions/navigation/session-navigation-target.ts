import type { AgentRole } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

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

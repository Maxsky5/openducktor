import type { SessionNavigationTarget } from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import type { SessionTarget } from "./session-target";

/** The navigation target of a session view, or null when the session has no known owner. */
export const visibleSessionTargetFor = (target: SessionTarget): SessionNavigationTarget | null => {
  const { workspaceId } = target.workspace;
  if (target.owner.kind === "task") {
    return {
      kind: "task_session",
      workspaceId,
      taskId: target.owner.taskId,
      role: target.owner.role,
      identity: target.identity,
    };
  }
  if (target.owner.kind === "chat") {
    return { kind: "workspace_session", workspaceId, sessionId: target.owner.record.id };
  }
  return null;
};

import type { WorkspaceSession } from "@openducktor/contracts";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import {
  sessionNavigationTargetKey,
  type SessionNavigationTarget,
} from "./session-navigation-target";
import { sessionReadStateKey } from "./session-read-state-store";

/** The read key of a chat. Its sidebar row uses the same key. */
export const workspaceSessionReadKey = (workspaceId: string, session: WorkspaceSession): string => {
  const identity = workspaceSessionIdentity(session);
  return identity
    ? sessionReadStateKey(workspaceId, identity)
    : sessionNavigationTargetKey({ kind: "workspace_session", workspaceId, sessionId: session.id });
};

export const sessionEntryReadKey = (entry: SessionNavigationEntry): string =>
  entry.context.kind === "workspace"
    ? workspaceSessionReadKey(entry.workspace.workspaceId, entry.context.session)
    : targetReadKey(entry.target);

export const targetReadKey = (target: SessionNavigationTarget): string =>
  target.kind === "task_session"
    ? sessionReadStateKey(target.workspaceId, target.identity)
    : sessionNavigationTargetKey(target);

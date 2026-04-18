import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentRuntimeConnection } from "@openducktor/core";
import {
  getRuntimeConnectionSupportError,
  runtimeRouteToConnection,
} from "@/state/operations/agent-orchestrator/runtime/runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const WORKTREE_RUNTIME_ROLES = new Set<AgentSessionState["role"]>(["build", "qa"]);

type RuntimeAttachmentState = Pick<AgentSessionState, "runId" | "runtimeId" | "runtimeRoute">;
type WorktreeRuntimeRole = Pick<AgentSessionState, "role">;
type SessionRuntimeAccessState = {
  runtimeKind?: AgentSessionState["runtimeKind"] | null;
  runtimeRoute: AgentSessionState["runtimeRoute"];
  workingDirectory: string;
};

export type AgentStudioSessionRuntimeQueryInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
};

export type AgentStudioSessionRuntimeQueryState = {
  runtimeQueryInput: AgentStudioSessionRuntimeQueryInput | null;
  runtimeQueryError: string | null;
};

export const requiresLiveWorktreeRuntime = (
  session: WorktreeRuntimeRole | null | undefined,
): boolean => {
  return Boolean(session && WORKTREE_RUNTIME_ROLES.has(session.role));
};

export const hasAttachedSessionRuntime = (
  session: RuntimeAttachmentState | null | undefined,
): boolean => {
  if (!session) {
    return false;
  }

  return session.runId !== null || session.runtimeId !== null || session.runtimeRoute !== null;
};

export const toAttachedSessionRuntimeConnection = (
  session:
    | Pick<AgentSessionState, "runtimeRoute" | "workingDirectory">
    | { runtimeRoute: AgentSessionState["runtimeRoute"]; workingDirectory: string }
    | null
    | undefined,
) => {
  if (!session?.runtimeRoute) {
    return null;
  }

  return runtimeRouteToConnection(session.runtimeRoute, session.workingDirectory);
};

export const getAttachedSessionRuntimeConnectionError = (
  session:
    | Pick<AgentSessionState, "runtimeRoute" | "workingDirectory">
    | { runtimeRoute: AgentSessionState["runtimeRoute"]; workingDirectory: string }
    | null
    | undefined,
  runtimeKind: RuntimeKind | null | undefined,
  action = "attached session runtime access",
): string | null => {
  if (!session?.runtimeRoute) {
    return null;
  }

  return getRuntimeConnectionSupportError(
    runtimeKind,
    runtimeRouteToConnection(session.runtimeRoute, session.workingDirectory),
    action,
  );
};

export const resolveAttachedSessionRuntimeQueryState = (
  session: SessionRuntimeAccessState | null | undefined,
  action = "attached session runtime access",
): AgentStudioSessionRuntimeQueryState => {
  const runtimeConnection = toAttachedSessionRuntimeConnection(session);
  const runtimeKind = session?.runtimeKind ?? null;

  return {
    runtimeQueryInput:
      runtimeKind && runtimeConnection
        ? {
            runtimeKind,
            runtimeConnection,
          }
        : null,
    runtimeQueryError: getAttachedSessionRuntimeConnectionError(session, runtimeKind, action),
  };
};

export const isWaitingForAttachedWorktreeRuntime = (
  session: (WorktreeRuntimeRole & RuntimeAttachmentState) | null | undefined,
): boolean => {
  return requiresLiveWorktreeRuntime(session) && !hasAttachedSessionRuntime(session);
};

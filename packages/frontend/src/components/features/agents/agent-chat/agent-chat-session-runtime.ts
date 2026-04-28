import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentRuntimeConnection } from "@openducktor/core";
import { runtimeRouteToConnection } from "@/state/operations/agent-orchestrator/runtime/runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type SessionRuntimeAccessState = {
  runtimeKind?: AgentSessionState["runtimeKind"] | null;
  runtimeRoute: AgentSessionState["runtimeRoute"];
  workingDirectory: string;
};

export type AgentChatSessionRuntimeQueryInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
};

export type AgentChatSessionRuntimeQueryState = {
  runtimeQueryInput: AgentChatSessionRuntimeQueryInput | null;
  runtimeQueryError: string | null;
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
): string | null => {
  if (!session?.runtimeRoute) {
    return null;
  }

  runtimeRouteToConnection(session.runtimeRoute, session.workingDirectory);
  return null;
};

export const resolveAttachedSessionRuntimeQueryState = (
  session: SessionRuntimeAccessState | null | undefined,
): AgentChatSessionRuntimeQueryState => {
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
    runtimeQueryError: getAttachedSessionRuntimeConnectionError(session),
  };
};

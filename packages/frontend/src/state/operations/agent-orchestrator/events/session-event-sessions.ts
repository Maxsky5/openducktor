import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { SessionLifecycleEventContext } from "./session-event-types";

export const normalizeSessionId = (externalSessionId: string | undefined): string | null => {
  const trimmed = externalSessionId?.trim();
  return trimmed ? trimmed : null;
};

export const readSessionInEventRuntime = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  externalSessionId: string,
): AgentSessionState | null =>
  context.store.readSession({
    externalSessionId,
    runtimeKind: context.session.identity.runtimeKind,
    workingDirectory: context.session.identity.workingDirectory,
  });

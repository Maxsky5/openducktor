import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexSubagentLinkState, CodexSubagentRoute } from "./codex-subagent-link-state";
import type { CodexSessionState } from "./types";

/** Stop at the nearest retained session; never cross into another runtime. */
export const findRetainedSessionOwner = ({
  sessions,
  subagents,
  runtimeId,
  threadId,
}: {
  sessions: Pick<CodexSessionLookup, "get">;
  subagents: Pick<CodexSubagentLinkState, "routeForChild">;
  runtimeId: string;
  threadId: string;
}): CodexRetainedSessionOwner | undefined => {
  const visited = new Set<string>();
  let currentThreadId = threadId;
  let targetRoute: CodexSubagentRoute | null = null;
  while (!visited.has(currentThreadId)) {
    visited.add(currentThreadId);
    const retainedSession = sessions.get(currentThreadId);
    if (retainedSession) {
      return retainedSession.runtimeId === runtimeId
        ? { retainedSession, route: targetRoute }
        : undefined;
    }
    const route = subagents.routeForChild(currentThreadId, runtimeId);
    if (!route || (route.runtimeId && route.runtimeId !== runtimeId)) {
      return undefined;
    }
    targetRoute ??= route;
    currentThreadId = route.parentExternalSessionId;
  }
  return undefined;
};

type CodexRetainedSessionOwner = {
  retainedSession: CodexSessionState;
  /** Keep the target's route even when its retained owner is several parents above it. */
  route: CodexSubagentRoute | null;
};

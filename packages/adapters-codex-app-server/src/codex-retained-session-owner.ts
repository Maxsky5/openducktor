import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexSubagentLinkState, CodexSubagentRoute } from "./codex-subagent-link-state";
import type { CodexSessionState } from "./types";

type CodexRetainedSessionOwner = {
  retainedSession: CodexSessionState;
  /** The target's route, or null when the target itself is retained. */
  route: CodexSubagentRoute | null;
};

export const resolveCodexRetainedSessionOwner = ({
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

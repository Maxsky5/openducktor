import type { AgentSessionRef } from "@openducktor/core";
import { type AgentSessionCollection, getAgentSession } from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  loadSessionHistorySnapshots,
  type SessionHistoryLoaderAdapter,
  type SessionHistoryLoadResult,
} from "./session-history-loader";
import {
  type SessionHistoryRuntimeContext,
  withSessionHistoryRuntimeContext,
} from "./session-history-runtime-context";

type UpdateSession = Parameters<typeof loadSessionHistorySnapshots>[0]["updateSession"];

const selectSessionHistoryTargets = ({
  sessionCollection,
  liveSessionRefs,
  requestedSession,
}: {
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: AgentSessionRef[];
  requestedSession?: AgentSessionIdentity | null | undefined;
}): AgentSessionState[] => {
  if (requestedSession) {
    const session = getAgentSession(sessionCollection, requestedSession);
    if (!session) {
      throw new Error(
        `Cannot load history for unknown session '${requestedSession.externalSessionId}'.`,
      );
    }
    return [session];
  }

  const targets: AgentSessionState[] = [];
  for (const ref of liveSessionRefs) {
    const session = getAgentSession(sessionCollection, ref);
    if (!session) {
      throw new Error(
        `Cannot load history for live session '${ref.externalSessionId}': session is missing from the repo read model.`,
      );
    }
    if (session.historyLoadState === "not_requested") {
      targets.push(session);
    }
  }
  return targets;
};

export const loadSessionHistoryForReadModel = async ({
  repoPath,
  adapter,
  updateSession,
  sessionCollection,
  liveSessionRefs,
  historyRuntimeContext,
  isStaleRepoOperation,
  requestedSession,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: AgentSessionRef[];
  historyRuntimeContext: SessionHistoryRuntimeContext;
  isStaleRepoOperation: () => boolean;
  requestedSession?: AgentSessionIdentity | null | undefined;
}): Promise<SessionHistoryLoadResult[]> => {
  const historySessions = selectSessionHistoryTargets({
    sessionCollection,
    liveSessionRefs,
    requestedSession,
  });

  if (historySessions.length === 0) {
    return [];
  }

  const historySessionsWithRuntimeContext = await withSessionHistoryRuntimeContext({
    sessions: historySessions,
    context: historyRuntimeContext,
  });
  if (isStaleRepoOperation()) {
    return historySessions.map((session) => ({
      externalSessionId: session.externalSessionId,
      status: "stale",
    }));
  }

  return loadSessionHistorySnapshots({
    repoPath,
    adapter,
    updateSession,
    sessions: historySessionsWithRuntimeContext,
    isStaleRepoOperation,
  });
};

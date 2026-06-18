import type { AgentSessionRef } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
import { listAgentSessions } from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";

export type RepoSessionLocalStatePartition = {
  carriedSessions: AgentSessionState[];
  removedSessionRefs: AgentSessionRef[];
};

const shouldKeepLocalSessionWithoutPersistedRecord = (session: AgentSessionState): boolean =>
  session.status === "starting";

export const partitionRepoSessionLocalState = ({
  repoPath,
  currentSessions,
  loadedTaskIds,
  persistedSessionKeys,
}: {
  repoPath: string;
  currentSessions: AgentSessionCollection;
  loadedTaskIds: ReadonlySet<string>;
  persistedSessionKeys: ReadonlySet<string>;
}): RepoSessionLocalStatePartition => {
  const carriedSessions: AgentSessionState[] = [];
  const removedSessionRefs: AgentSessionRef[] = [];

  for (const session of listAgentSessions(currentSessions)) {
    if (
      !loadedTaskIds.has(session.taskId) ||
      shouldKeepLocalSessionWithoutPersistedRecord(session)
    ) {
      carriedSessions.push(session);
      continue;
    }

    if (!persistedSessionKeys.has(agentSessionIdentityKey(session))) {
      removedSessionRefs.push(toRuntimeSessionRef(repoPath, session));
    }
  }

  return { carriedSessions, removedSessionRefs };
};

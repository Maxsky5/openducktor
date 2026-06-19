import type { AgentSessionRef } from "@openducktor/core";
import { toMissingAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toPersistedSessionIdentity, toPersistedSessionView } from "../support/persistence";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";
import type { RepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import {
  applyRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";
import type { TaskSessionRecords } from "./task-session-records";

export type RepoSessionReadModel = {
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: AgentSessionRef[];
  unlistedSessionRefs: AgentSessionRef[];
};

const shouldKeepLocalSessionWithoutPersistedRecord = (session: AgentSessionState): boolean =>
  session.status === "starting";

export const buildRepoSessionReadModel = ({
  repoPath,
  tasks,
  currentSessionCollection,
  runtimeSnapshots,
}: {
  repoPath: string;
  tasks: TaskSessionRecords;
  currentSessionCollection?: AgentSessionCollection;
  runtimeSnapshots: RepoRuntimeSessionSnapshots;
}): RepoSessionReadModel => {
  const loadedTaskIds = new Set(tasks.taskIds);
  const persistedSessionKeys = new Set(
    tasks.records.map(({ record }) => agentSessionIdentityKey(toPersistedSessionIdentity(record))),
  );
  const currentSessions = currentSessionCollection ?? emptyAgentSessionCollection();
  const carriedSessions: AgentSessionState[] = [];
  const unlistedSessionRefs: AgentSessionRef[] = [];

  for (const session of listAgentSessions(currentSessions)) {
    if (
      !loadedTaskIds.has(session.taskId) ||
      shouldKeepLocalSessionWithoutPersistedRecord(session)
    ) {
      carriedSessions.push(session);
      continue;
    }

    if (!persistedSessionKeys.has(agentSessionIdentityKey(session))) {
      unlistedSessionRefs.push(toRuntimeSessionRef(repoPath, session));
    }
  }

  let sessionCollection = createAgentSessionCollection(carriedSessions);
  const liveSessionRefs: AgentSessionRef[] = [];

  for (const { taskId, record } of tasks.records) {
    const identity = toPersistedSessionIdentity(record);
    const ref = toRuntimeSessionRef(repoPath, identity);
    const sessionKey = agentSessionIdentityKey(identity);
    const current = getAgentSession(currentSessions, identity) ?? undefined;
    const snapshot = runtimeSnapshots.get(sessionKey) ?? toMissingAgentSessionRuntimeSnapshot(ref);
    const persistedSessionView = toPersistedSessionView({
      taskId,
      record,
      current,
    });
    const session = applyRuntimeSnapshotToSession(persistedSessionView, snapshot);
    sessionCollection = replaceAgentSession(sessionCollection, session);

    if (shouldObserveAgentSessionRuntimeSnapshot(snapshot)) {
      liveSessionRefs.push(toRuntimeSessionRef(repoPath, session));
    }
  }

  return {
    sessionCollection,
    liveSessionRefs,
    unlistedSessionRefs,
  };
};

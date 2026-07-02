import type {
  AgentSessionRuntimePolicy,
  AgentSessionRuntimeRef,
  AgentSessionScope,
  RuntimeKind,
} from "@openducktor/core";
import { toMissingAgentSessionRuntimeSnapshot, workflowAgentSessionScope } from "@openducktor/core";
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
import { projectRuntimeChildPendingInputToSession } from "../pending-input-projection";
import { toPersistedSessionIdentity, toPersistedSessionView } from "../support/persistence";
import { toRuntimeSessionRef, toRuntimeSessionRefWithPolicy } from "../support/session-runtime-ref";
import type { RepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import {
  applyRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";
import type { TaskSessionRecords } from "./task-session-records";

export type RepoSessionReadModel = {
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: AgentSessionRuntimeRef[];
  unlistedSessionRefs: AgentSessionRuntimeRef[];
};

export type ResolveSessionRuntimePolicySync = (input: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
}) => AgentSessionRuntimePolicy;

const shouldKeepLocalSessionWithoutPersistedRecord = (session: AgentSessionState): boolean =>
  session.status === "starting";

export const buildRepoSessionReadModel = ({
  repoPath,
  tasks,
  currentSessionCollection,
  runtimeSnapshots,
  resolveSessionRuntimePolicy,
}: {
  repoPath: string;
  tasks: TaskSessionRecords;
  currentSessionCollection?: AgentSessionCollection;
  runtimeSnapshots: RepoRuntimeSessionSnapshots;
  resolveSessionRuntimePolicy: ResolveSessionRuntimePolicySync;
}): RepoSessionReadModel => {
  const loadedTaskIds = new Set(tasks.taskIds);
  const persistedSessionKeys = new Set(
    tasks.records.map(({ record }) => agentSessionIdentityKey(toPersistedSessionIdentity(record))),
  );
  const currentSessions = currentSessionCollection ?? emptyAgentSessionCollection();
  const carriedSessions: AgentSessionState[] = [];
  const unlistedSessionRefs: AgentSessionRuntimeRef[] = [];
  const materializedSessionKeys = new Set(persistedSessionKeys);
  const runtimePolicyForSession = (session: AgentSessionState): AgentSessionRuntimePolicy => {
    return resolveSessionRuntimePolicy({
      runtimeKind: session.runtimeKind,
      sessionScope: session.role ? workflowAgentSessionScope(session.taskId, session.role) : null,
    });
  };

  for (const session of listAgentSessions(currentSessions)) {
    if (
      !loadedTaskIds.has(session.taskId) ||
      shouldKeepLocalSessionWithoutPersistedRecord(session)
    ) {
      carriedSessions.push(session);
      materializedSessionKeys.add(agentSessionIdentityKey(session));
      continue;
    }

    if (!persistedSessionKeys.has(agentSessionIdentityKey(session))) {
      unlistedSessionRefs.push(
        toRuntimeSessionRefWithPolicy(repoPath, session, runtimePolicyForSession(session)),
      );
    }
  }

  let sessionCollection = createAgentSessionCollection(carriedSessions);
  const liveSessionRefs: AgentSessionRuntimeRef[] = [];

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
    const directSession = applyRuntimeSnapshotToSession(persistedSessionView, snapshot);
    const projectedPendingInput = projectRuntimeChildPendingInputToSession({
      session: directSession,
      runtimeSnapshots,
      materializedSessionKeys,
    });
    const session = projectedPendingInput.session;
    sessionCollection = replaceAgentSession(sessionCollection, session);

    if (
      shouldObserveAgentSessionRuntimeSnapshot(snapshot) ||
      projectedPendingInput.hasProjectedChildPendingInput
    ) {
      liveSessionRefs.push(
        toRuntimeSessionRefWithPolicy(repoPath, session, runtimePolicyForSession(session)),
      );
    }
  }

  return {
    sessionCollection,
    liveSessionRefs,
    unlistedSessionRefs,
  };
};

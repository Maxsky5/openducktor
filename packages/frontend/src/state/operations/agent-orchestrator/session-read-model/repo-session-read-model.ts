import type {
  AgentSessionRuntimePolicy,
  AgentSessionScope,
  PolicyBoundSessionRef,
  RuntimeKind,
  SessionRef,
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
import { runtimeChildSnapshotsForSession } from "./runtime-child-snapshots";
import {
  applyRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";
import type { TaskSessionRecords } from "./task-session-records";

export type RepoSessionReadModel = {
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: PolicyBoundSessionRef[];
  unlistedSessionRefs: SessionRef[];
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
  const unlistedSessionRefs: SessionRef[] = [];
  const materializedSessionKeys = new Set(persistedSessionKeys);
  const workflowScopeForSession = (session: AgentSessionState): AgentSessionScope | null => {
    return session.role ? workflowAgentSessionScope(session.taskId, session.role) : null;
  };
  const runtimePolicyForSession = (
    session: AgentSessionState,
    sessionScope = workflowScopeForSession(session),
  ): AgentSessionRuntimePolicy => {
    return resolveSessionRuntimePolicy({
      runtimeKind: session.runtimeKind,
      sessionScope,
    });
  };
  const policyBoundSessionRefForSession = (session: AgentSessionState): PolicyBoundSessionRef => {
    const sessionScope = workflowScopeForSession(session);
    return {
      ...toRuntimeSessionRefWithPolicy(
        repoPath,
        session,
        runtimePolicyForSession(session, sessionScope),
      ),
      ...(sessionScope ? { sessionScope } : {}),
    };
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
      unlistedSessionRefs.push(toRuntimeSessionRef(repoPath, session));
    }
  }

  let sessionCollection = createAgentSessionCollection(carriedSessions);
  const liveSessionRefs: PolicyBoundSessionRef[] = [];

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
    const runtimeChildSnapshots = runtimeChildSnapshotsForSession({
      session: directSession,
      runtimeSnapshots,
      materializedSessionKeys,
    });
    const projectedPendingInput = projectRuntimeChildPendingInputToSession({
      session: directSession,
      runtimeChildSnapshots,
    });
    const session = projectedPendingInput.session;
    const hasActiveRuntimeChild = runtimeChildSnapshots.some(
      shouldObserveAgentSessionRuntimeSnapshot,
    );
    sessionCollection = replaceAgentSession(sessionCollection, session);

    if (
      shouldObserveAgentSessionRuntimeSnapshot(snapshot) ||
      projectedPendingInput.hasProjectedChildPendingInput ||
      hasActiveRuntimeChild
    ) {
      liveSessionRefs.push(policyBoundSessionRefForSession(session));
    }
  }

  return {
    sessionCollection,
    liveSessionRefs,
    unlistedSessionRefs,
  };
};

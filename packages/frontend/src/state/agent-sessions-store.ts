import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  areAgentSessionCollectionsEquivalent,
  emptyAgentSessionCollection,
  getAgentSession,
  hasAgentSessionStateChanges,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import {
  type AgentActivitySessionsSnapshot,
  createAgentActivitySnapshot,
  createEmptyAgentActivitySnapshot,
} from "@/state/agent-session-snapshots";
import {
  type AgentSessionVisiblePendingInput,
  getAgentSessionVisiblePendingInput,
} from "@/state/agent-session-visible-pending-input";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export {
  type AgentActivitySessionsSnapshot,
  type AgentSessionSummary,
  toAgentSessionSummary,
} from "@/state/agent-session-snapshots";

type Listener = () => void;
type AgentSessionCollectionCommit<Result> = (current: AgentSessionCollection) => {
  collection: AgentSessionCollection;
  result: Result;
};

const REPOSITORY_RETENTION_LIMIT = 2;
export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  getActivitySnapshot: () => AgentActivitySessionsSnapshot;
  listSessionSnapshots: () => AgentSessionState[];
  getSessionSnapshot: (identity: AgentSessionIdentity | null) => AgentSessionState | null;
  getVisiblePendingInputSnapshot: (
    identity: AgentSessionIdentity | null,
  ) => AgentSessionVisiblePendingInput;
  commitSessionCollection: <Result>(commit: AgentSessionCollectionCommit<Result>) => Result;
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  replaceSession: (session: AgentSessionState) => void;
  removeSession: (identity: AgentSessionIdentity) => void;
  updateSession: (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
  ) => AgentSessionState | null;
  resetWorkspace: (workspaceRepoPath: string | null) => void;
};

export const createAgentSessionsStore = (
  initialWorkspaceRepoPath: string | null = null,
  repositoryRetentionLimit: number = REPOSITORY_RETENTION_LIMIT,
): AgentSessionsStore => {
  let workspaceRepoPath = initialWorkspaceRepoPath;
  const retainedCollections = new Map<string, AgentSessionCollection>();
  let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
  if (workspaceRepoPath !== null) {
    retainedCollections.set(workspaceRepoPath, sessionCollection);
  }
  let activitySnapshot = createEmptyAgentActivitySnapshot(workspaceRepoPath);
  type VisiblePendingInputSnapshot = {
    collection: AgentSessionCollection;
    identityKey: string | null;
    snapshot: AgentSessionVisiblePendingInput;
  };
  let visiblePendingInputSnapshot: VisiblePendingInputSnapshot | null = null;
  const listeners = new Set<Listener>();

  const notifyListeners = (): void => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- listeners can unsubscribe during delivery
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const commitSessionCollection = <Result>(
    commit: AgentSessionCollectionCommit<Result>,
  ): Result => {
    const { collection: nextCollection, result } = commit(sessionCollection);
    if (areAgentSessionCollectionsEquivalent(sessionCollection, nextCollection)) {
      return result;
    }

    sessionCollection = nextCollection;
    activitySnapshot = createAgentActivitySnapshot({
      collection: nextCollection,
      previous: activitySnapshot,
      workspaceRepoPath,
    });
    notifyListeners();
    return result;
  };

  const setSessionCollection = (updater: AgentSessionCollectionUpdater): void => {
    commitSessionCollection((current) => ({
      collection: updater(current),
      result: undefined,
    }));
  };

  // A repository switch drops the late result of a running load. Return an
  // unfinished load to not requested, so the next visit requests the baseline
  // history again.
  const reopenInterruptedHistoryLoads = (
    collection: AgentSessionCollection,
  ): AgentSessionCollection => {
    let next = collection;
    for (const session of listAgentSessions(collection)) {
      if (session.historyLoadState === "loading") {
        next = replaceAgentSession(next, { ...session, historyLoadState: "not_requested" });
      }
    }
    return next;
  };

  const retainActiveCollection = (): void => {
    if (workspaceRepoPath === null) {
      return;
    }
    retainedCollections.set(workspaceRepoPath, reopenInterruptedHistoryLoads(sessionCollection));
  };

  const activateCollection = (repoPath: string | null): AgentSessionCollection => {
    if (repoPath === null) {
      return emptyAgentSessionCollection();
    }
    const collection = retainedCollections.get(repoPath) ?? emptyAgentSessionCollection();
    retainedCollections.delete(repoPath);
    retainedCollections.set(repoPath, collection);
    return collection;
  };

  const evictOldestCollections = (): void => {
    while (retainedCollections.size > repositoryRetentionLimit) {
      const oldestRepoPath = retainedCollections.keys().next().value;
      if (oldestRepoPath === undefined) {
        return;
      }
      retainedCollections.delete(oldestRepoPath);
    }
  };

  const dropEvictedPendingInput = (): void => {
    if (visiblePendingInputSnapshot === null) {
      return;
    }
    if ([...retainedCollections.values()].includes(visiblePendingInputSnapshot.collection)) {
      return;
    }
    visiblePendingInputSnapshot = null;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getActivitySnapshot: () => activitySnapshot,
    listSessionSnapshots: () => listAgentSessions(sessionCollection),
    getSessionSnapshot: (identity) => getAgentSession(sessionCollection, identity),
    getVisiblePendingInputSnapshot: (identity) => {
      const identityKey = identity ? agentSessionIdentityKey(identity) : null;
      if (
        visiblePendingInputSnapshot?.collection === sessionCollection &&
        visiblePendingInputSnapshot.identityKey === identityKey
      ) {
        return visiblePendingInputSnapshot.snapshot;
      }

      const snapshot = getAgentSessionVisiblePendingInput(sessionCollection, identity);
      visiblePendingInputSnapshot = { collection: sessionCollection, identityKey, snapshot };
      return snapshot;
    },
    commitSessionCollection,
    setSessionCollection,
    replaceSession: (session) => {
      setSessionCollection((current) => replaceAgentSession(current, session));
    },
    removeSession: (identity) => {
      setSessionCollection((current) => removeAgentSession(current, identity));
    },
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionCollection, identity);
      if (!current) {
        return null;
      }

      const nextSession = updater(current);
      if (nextSession === current || !hasAgentSessionStateChanges(current, nextSession)) {
        return null;
      }

      setSessionCollection((current) =>
        replaceAgentSessionByIdentity(current, identity, nextSession),
      );
      return nextSession;
    },
    resetWorkspace: (nextWorkspaceRepoPath) => {
      retainActiveCollection();
      workspaceRepoPath = nextWorkspaceRepoPath;
      sessionCollection = activateCollection(nextWorkspaceRepoPath);
      evictOldestCollections();
      dropEvictedPendingInput();
      activitySnapshot = createAgentActivitySnapshot({
        collection: sessionCollection,
        previous:
          activitySnapshot.workspaceRepoPath === workspaceRepoPath
            ? activitySnapshot
            : createEmptyAgentActivitySnapshot(workspaceRepoPath),
        workspaceRepoPath,
      });
      notifyListeners();
    },
  };
};

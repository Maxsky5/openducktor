import type { AgentSessionAssociation } from "@openducktor/contracts";
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
  type AgentSessionLiveAssociations,
  emptyAgentSessionLiveAssociations,
  getAgentSessionLiveAssociation,
} from "@/state/agent-session-live-associations";
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
type AgentSessionLiveAssociationsUpdater = (
  current: AgentSessionLiveAssociations,
) => AgentSessionLiveAssociations;

export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  subscribeLiveAssociations: (listener: Listener) => () => void;
  getActivitySnapshot: () => AgentActivitySessionsSnapshot;
  listSessionSnapshots: () => AgentSessionState[];
  getSessionSnapshot: (identity: AgentSessionIdentity | null) => AgentSessionState | null;
  getLiveAssociationSnapshot: (
    identity: AgentSessionIdentity | null,
  ) => AgentSessionAssociation | null;
  getVisiblePendingInputSnapshot: (
    identity: AgentSessionIdentity | null,
  ) => AgentSessionVisiblePendingInput;
  commitSessionCollection: <Result>(commit: AgentSessionCollectionCommit<Result>) => Result;
  setLiveAssociations: (updater: AgentSessionLiveAssociationsUpdater) => void;
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
): AgentSessionsStore => {
  let workspaceRepoPath = initialWorkspaceRepoPath;
  let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
  let liveAssociations = emptyAgentSessionLiveAssociations();
  let activitySnapshot = createEmptyAgentActivitySnapshot(workspaceRepoPath);
  let visiblePendingInputSnapshot: {
    collection: AgentSessionCollection;
    identityKey: string | null;
    snapshot: AgentSessionVisiblePendingInput;
  } | null = null;
  const listeners = new Set<Listener>();
  const liveAssociationListeners = new Set<Listener>();

  const notifyListeners = (): void => {
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

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeLiveAssociations: (listener) => {
      liveAssociationListeners.add(listener);
      return () => {
        liveAssociationListeners.delete(listener);
      };
    },
    getActivitySnapshot: () => activitySnapshot,
    listSessionSnapshots: () => listAgentSessions(sessionCollection),
    getSessionSnapshot: (identity) => getAgentSession(sessionCollection, identity),
    getLiveAssociationSnapshot: (identity) =>
      getAgentSessionLiveAssociation(liveAssociations, identity),
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
    setLiveAssociations: (updater) => {
      const next = updater(liveAssociations);
      if (next === liveAssociations) {
        return;
      }
      liveAssociations = next;
      for (const listener of [...liveAssociationListeners]) {
        listener();
      }
    },
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
      workspaceRepoPath = nextWorkspaceRepoPath;
      sessionCollection = emptyAgentSessionCollection();
      liveAssociations = emptyAgentSessionLiveAssociations();
      activitySnapshot = createEmptyAgentActivitySnapshot(workspaceRepoPath);
      notifyListeners();
      for (const listener of [...liveAssociationListeners]) {
        listener();
      }
    },
  };
};

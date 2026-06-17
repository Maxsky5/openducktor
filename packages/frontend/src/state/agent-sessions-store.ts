import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  areAgentSessionCollectionsEquivalent,
  emptyAgentSessionCollection,
  getAgentSession,
  hasAgentSessionStateChanges,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import {
  type AgentActivitySessionsSnapshot,
  type AgentSessionSummary,
  createAgentSessionSnapshots,
  createEmptyAgentSessionSnapshots,
} from "@/state/agent-session-snapshots";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export {
  type AgentActivitySessionsSnapshot,
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
  toAgentSessionSummary,
  type WorkflowAgentSessionSummary,
} from "@/state/agent-session-snapshots";

type Listener = () => void;

export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  getSessionSummariesSnapshot: () => AgentSessionSummary[];
  getActivitySnapshot: () => AgentActivitySessionsSnapshot;
  getSessionSnapshot: (identity: AgentSessionIdentity | null) => AgentSessionState | null;
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
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
  let snapshots = createEmptyAgentSessionSnapshots(workspaceRepoPath);
  const listeners = new Set<Listener>();

  const notifyListeners = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setSessionCollection = (updater: AgentSessionCollectionUpdater): void => {
    const nextCollection = typeof updater === "function" ? updater(sessionCollection) : updater;
    if (areAgentSessionCollectionsEquivalent(sessionCollection, nextCollection)) {
      return;
    }

    sessionCollection = nextCollection;
    snapshots = createAgentSessionSnapshots({
      collection: nextCollection,
      previous: snapshots,
      workspaceRepoPath,
    });
    notifyListeners();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSessionSummariesSnapshot: () => snapshots.sessionSummaries,
    getActivitySnapshot: () => snapshots.activitySnapshot,
    getSessionSnapshot: (identity) => getAgentSession(sessionCollection, identity),
    setSessionCollection,
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionCollection, identity);
      if (!current) {
        return null;
      }

      const nextSession = updater(current);
      if (nextSession === current || !hasAgentSessionStateChanges(current, nextSession)) {
        return null;
      }

      setSessionCollection(replaceAgentSessionByIdentity(sessionCollection, identity, nextSession));
      return nextSession;
    },
    resetWorkspace: (nextWorkspaceRepoPath) => {
      workspaceRepoPath = nextWorkspaceRepoPath;
      sessionCollection = emptyAgentSessionCollection();
      snapshots = createEmptyAgentSessionSnapshots(workspaceRepoPath);
      notifyListeners();
    },
  };
};

import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
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
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { upsertSessionMessage } from "./operations/agent-orchestrator/support/messages";
import { buildSessionPolicyNoticeMessage } from "./operations/agent-orchestrator/support/session-notice-messages";
import { markSessionHistoriesStale } from "./operations/agent-orchestrator/history/session-history-freshness";

export {
  type AgentActivitySessionsSnapshot,
  type AgentSessionSummary,
  toAgentSessionSummary,
} from "@/state/agent-session-snapshots";

type Listener = () => void;
type LivePolicyEnvelope = Extract<
  AgentSessionLiveEnvelope,
  { type: "snapshot" | "session_upsert" | "session_removed" }
>;
type AgentSessionCollectionCommit<Result> = (current: AgentSessionCollection) => {
  collection: AgentSessionCollection;
  result: Result;
};
export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  getActivitySnapshot: () => AgentActivitySessionsSnapshot;
  listSessionSnapshots: () => AgentSessionState[];
  getSessionSnapshot: (identity: AgentSessionIdentity | null) => AgentSessionState | null;
  getVisiblePendingInputSnapshot: (
    identity: AgentSessionIdentity | null,
  ) => AgentSessionVisiblePendingInput;
  commitSessionCollection: <Result>(commit: AgentSessionCollectionCommit<Result>) => Result;
  applyLivePolicyNotices: (envelope: LivePolicyEnvelope) => void;
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
  // Keep one current notice for each live identity, including roots not registered yet.
  const policyNotices = new Map<string, AgentChatMessage>();

  const projectPolicyNotices = (collection: AgentSessionCollection): AgentSessionCollection => {
    let next = collection;
    for (const [key, notice] of policyNotices) {
      const session = next.get(key);
      if (!session) continue;
      const messages = upsertSessionMessage(session, notice);
      if (messages !== session.messages) {
        next = replaceAgentSession(next, { ...session, messages });
      }
    }
    return next;
  };

  const retainPolicyNotice = (snapshot: AgentSessionLiveSnapshot): void => {
    const key = agentSessionIdentityKey(snapshot.ref);
    const notice = snapshot.policyNotice;
    if (!notice) {
      policyNotices.delete(key);
      return;
    }
    const current = policyNotices.get(key);
    if (
      current?.id !== notice.messageId ||
      current.content !== notice.message ||
      current.timestamp !== notice.timestamp
    ) {
      policyNotices.set(
        key,
        buildSessionPolicyNoticeMessage(notice.timestamp, notice.message, notice.messageId),
      );
    }
  };

  const notifyListeners = (): void => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- listeners can unsubscribe during delivery
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const commitSessionCollection = <Result>(
    commit: AgentSessionCollectionCommit<Result>,
  ): Result => {
    const { collection, result } = commit(sessionCollection);
    const nextCollection = projectPolicyNotices(collection);
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

  const retainActiveCollection = (): void => {
    if (workspaceRepoPath === null) {
      return;
    }
    retainedCollections.set(workspaceRepoPath, markSessionHistoriesStale(sessionCollection));
  };

  const activateCollection = (repoPath: string | null): AgentSessionCollection => {
    if (repoPath === null) {
      return emptyAgentSessionCollection();
    }
    return retainedCollections.get(repoPath) ?? emptyAgentSessionCollection();
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
    applyLivePolicyNotices: (envelope) => {
      const repoPath =
        envelope.type === "snapshot"
          ? envelope.repoPath
          : envelope.type === "session_upsert"
            ? envelope.session.ref.repoPath
            : envelope.ref.repoPath;
      if (repoPath !== workspaceRepoPath) return;
      if (envelope.type === "snapshot") {
        policyNotices.clear();
        for (const snapshot of envelope.sessions) retainPolicyNotice(snapshot);
      } else if (envelope.type === "session_upsert") {
        retainPolicyNotice(envelope.session);
      } else {
        policyNotices.delete(agentSessionIdentityKey(envelope.ref));
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
      return getAgentSession(sessionCollection, nextSession);
    },
    resetWorkspace: (nextWorkspaceRepoPath) => {
      retainActiveCollection();
      if (nextWorkspaceRepoPath !== workspaceRepoPath) policyNotices.clear();
      workspaceRepoPath = nextWorkspaceRepoPath;
      sessionCollection = activateCollection(nextWorkspaceRepoPath);
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

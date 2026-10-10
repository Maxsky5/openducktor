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
import {
  upsertSessionMessage,
  upsertSessionMessageByTimestamp,
} from "./operations/agent-orchestrator/support/messages";
import {
  buildSessionErrorNoticeMessage,
  buildSessionPolicyNoticeMessage,
} from "./operations/agent-orchestrator/support/session-notice-messages";
import { markSessionHistoriesStale } from "./operations/agent-orchestrator/history/session-history-freshness";

export {
  type AgentActivitySessionsSnapshot,
  type AgentSessionSummary,
  toAgentSessionSummary,
} from "@/state/agent-session-snapshots";

type Listener = () => void;
type LiveNoticeEnvelope = Extract<
  AgentSessionLiveEnvelope,
  { type: "snapshot" | "session_upsert" | "session_removed" }
>;
type LiveNotice = NonNullable<AgentSessionLiveSnapshot["policyNotice"]>;
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
  applyLiveNotices: (envelope: LiveNoticeEnvelope) => void;
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
  // Keep the current notices of each live identity, including roots not registered yet. History
  // reloads replace messages, so each commit puts the notices back.
  const policyNotices = new Map<string, AgentChatMessage>();
  const launchFailures = new Map<string, AgentChatMessage>();

  const projectNotices = (
    collection: AgentSessionCollection,
    notices: Map<string, AgentChatMessage>,
    upsert: typeof upsertSessionMessage,
  ): AgentSessionCollection => {
    let next = collection;
    for (const [key, notice] of notices) {
      const session = next.get(key);
      if (!session) continue;
      const messages = upsert(session, notice);
      if (messages !== session.messages) {
        next = replaceAgentSession(next, { ...session, messages });
      }
    }
    return next;
  };
  const projectLiveNotices = (collection: AgentSessionCollection): AgentSessionCollection =>
    // A launch failure can come before later runtime history, so it keeps its time order.
    projectNotices(
      projectNotices(collection, policyNotices, upsertSessionMessage),
      launchFailures,
      upsertSessionMessageByTimestamp,
    );

  const retainNotice = (
    notices: Map<string, AgentChatMessage>,
    key: string,
    notice: LiveNotice | undefined,
    build: (timestamp: string, message: string, id: string) => AgentChatMessage,
  ): void => {
    if (!notice) {
      notices.delete(key);
      return;
    }
    const current = notices.get(key);
    if (
      current?.id !== notice.messageId ||
      current.content !== notice.message ||
      current.timestamp !== notice.timestamp
    ) {
      notices.set(key, build(notice.timestamp, notice.message, notice.messageId));
    }
  };
  const retainLiveNotices = (snapshot: AgentSessionLiveSnapshot): void => {
    const key = agentSessionIdentityKey(snapshot.ref);
    retainNotice(policyNotices, key, snapshot.policyNotice, buildSessionPolicyNoticeMessage);
    retainNotice(launchFailures, key, snapshot.launchFailure, buildSessionErrorNoticeMessage);
  };
  const clearLiveNotices = (key?: string): void => {
    for (const notices of [policyNotices, launchFailures]) {
      if (key === undefined) notices.clear();
      else notices.delete(key);
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
    const nextCollection = projectLiveNotices(collection);
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
    applyLiveNotices: (envelope) => {
      switch (envelope.type) {
        case "snapshot":
          if (envelope.repoPath !== workspaceRepoPath) return;
          clearLiveNotices();
          for (const snapshot of envelope.sessions) retainLiveNotices(snapshot);
          return;
        case "session_upsert":
          if (envelope.session.ref.repoPath !== workspaceRepoPath) return;
          retainLiveNotices(envelope.session);
          return;
        case "session_removed":
          if (envelope.ref.repoPath !== workspaceRepoPath) return;
          clearLiveNotices(agentSessionIdentityKey(envelope.ref));
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
      if (nextWorkspaceRepoPath !== workspaceRepoPath) clearLiveNotices();
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

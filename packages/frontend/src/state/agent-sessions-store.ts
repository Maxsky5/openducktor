import { projectSessionSnapshotActivity } from "./operations/agent-orchestrator/session-read-model/agent-session-live-projection";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  AgentSessionLiveRef,
  AgentMessageQueueSnapshot,
  SessionOperationObservation,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { replaceEqualDeep } from "@tanstack/react-query";
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
  removeSessionMessageById,
  upsertSessionMessage,
  upsertSessionMessageByTimestamp,
} from "./operations/agent-orchestrator/support/messages";
import {
  buildSessionErrorNoticeMessage,
  buildSessionPolicyNoticeMessage,
} from "./operations/agent-orchestrator/support/session-notice-messages";
import {
  markSessionHistoriesStale,
  markSessionHistoryStale,
} from "./operations/agent-orchestrator/history/session-history-freshness";
import type {
  SessionHistoryFreshnessTracker,
  SessionHistoryVersion,
} from "./queries/agent-session-history-freshness-tracker";

export {
  type AgentActivitySessionsSnapshot,
  type AgentSessionSummary,
  toAgentSessionSummary,
} from "@/state/agent-session-snapshots";

type Listener = () => void;
type LiveSessionStateEnvelope = Extract<
  AgentSessionLiveEnvelope,
  {
    type:
      | "snapshot"
      | "session_upsert"
      | "session_removed"
      | "session_operation_updated"
      | "submission_acknowledged"
      | "message_queue_updated";
  }
>;
type LiveNotice = NonNullable<AgentSessionLiveSnapshot["policyNotice"]>;
type SubmissionReceipt = {
  outcome: "accepted" | "queued";
  fromSnapshot: boolean;
};
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
  applyLiveSessionEnvelope: (envelope: LiveSessionStateEnvelope) => void;
  recordHistoryEnvelope: (envelope: AgentSessionLiveEnvelope) => void;
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  replaceSession: (session: AgentSessionState) => void;
  removeSession: (identity: AgentSessionIdentity) => void;
  updateSession: (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
  ) => AgentSessionState | null;
  /** The tasks that own workflow sessions in a workspace collection. */
  listSessionTaskIds: (repoPath: string) => string[];
  removeTaskSessions: (repoPath: string, taskIds: string[]) => void;
  resetWorkspace: (workspaceRepoPath: string | null) => void;
};

export const createAgentSessionsStore = (
  initialWorkspaceRepoPath: string | null = null,
  historyFreshness?: SessionHistoryFreshnessTracker,
): AgentSessionsStore => {
  let workspaceRepoPath = initialWorkspaceRepoPath;
  const pendingTaskRemovals = new Map<string, Set<string>>();
  const retainedCollections = new Map<string, AgentSessionCollection>();
  const retainedHistoryVersions = new Map<string, Map<string, SessionHistoryVersion>>();
  const historyProgress = historyFreshness?.createHistoryProgressTracker();
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
  const approvalFailures = new Map<string, AgentChatMessage>();
  const operations = new Map<string, Map<string, SessionOperationObservation>>();
  const operationFailures = new Map<string, Map<string, AgentChatMessage>>();
  const observedActivity = new Map<string, AgentSessionLiveSnapshot>();
  const acknowledged = new Map<string, Map<string, SubmissionReceipt>>();
  const noticeUpdates = new Set<string>();

  const needsNoticeProjection = (key: string, session: AgentSessionState) =>
    sessionCollection.get(key) !== session || noticeUpdates.has(key);

  const projectNotices = (
    collection: AgentSessionCollection,
    notices: Map<string, AgentChatMessage>,
    upsert: typeof upsertSessionMessage,
  ): AgentSessionCollection => {
    let next = collection;
    for (const [key, notice] of notices) {
      const session = next.get(key);
      if (!session || !needsNoticeProjection(key, session)) continue;
      const messages = upsert(session, notice);
      if (messages !== session.messages) {
        next = replaceAgentSession(next, { ...session, messages });
      }
    }
    return next;
  };
  const projectLiveNotices = (collection: AgentSessionCollection): AgentSessionCollection => {
    // A launch failure can come before later runtime history, so it keeps its time order.
    let projected = projectNotices(
      projectNotices(collection, policyNotices, upsertSessionMessage),
      launchFailures,
      upsertSessionMessageByTimestamp,
    );
    projected = projectNotices(projected, approvalFailures, upsertSessionMessageByTimestamp);
    for (const session of listAgentSessions(projected)) {
      const key = agentSessionIdentityKey(session);
      if (!needsNoticeProjection(key, session)) continue;
      const hostOperations = replaceEqualDeep(session.hostOperations ?? [], [
        ...(operations.get(key)?.values() ?? []),
      ]);
      const settledRefusals = hostOperations.filter(
        (operation) =>
          !operation.pending &&
          operation.kind === "submission" &&
          (operation.nativeOutcome === "not_issued" || operation.nativeOutcome === "refused"),
      );
      const retainedFailures = operationFailures.get(key);
      const receipts =
        workspaceRepoPath === null
          ? undefined
          : acknowledged.get(agentSessionRefKey({ ...session, repoPath: workspaceRepoPath }));
      let next = session;
      for (const message of session.messages.items) {
        if (message.id.startsWith("host-operation:") && !retainedFailures?.has(message.id))
          next = { ...next, messages: removeSessionMessageById(next, message.id) };
        const unresolvedSubmissionId =
          message.meta?.kind === "session_notice" && message.meta.reason === "session_error"
            ? message.meta.unresolvedSubmissionId
            : undefined;
        if (
          unresolvedSubmissionId &&
          (receipts?.has(unresolvedSubmissionId) ||
            settledRefusals.some((operation) => operation.submissionId === unresolvedSubmissionId))
        )
          next = { ...next, messages: removeSessionMessageById(next, message.id) };
      }
      if (
        hostOperations !== session.hostOperations &&
        (hostOperations.length > 0 || session.hostOperations !== undefined)
      )
        next = { ...next, hostOperations };
      const settledRefusal = settledRefusals.some(
        (operation) => operation.submissionId === session.pendingSubmissionId,
      );
      if (
        session.pendingSubmissionId &&
        (receipts?.has(session.pendingSubmissionId) || settledRefusal)
      ) {
        next = { ...next, pendingSubmissionId: undefined, pendingUserMessageStartedAt: undefined };
        const activity = observedActivity.get(key);
        const receipt = receipts?.get(session.pendingSubmissionId);
        if ((settledRefusal || receipt?.outcome === "queued" || receipt?.fromSnapshot) && activity)
          next = { ...next, ...projectSessionSnapshotActivity(next, activity) };
      }
      for (const notice of operationFailures.get(key)?.values() ?? [])
        next = { ...next, messages: upsertSessionMessageByTimestamp(next, notice) };
      if (next !== session) projected = replaceAgentSession(projected, next);
    }
    return projected;
  };

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
    noticeUpdates.add(key);
    observedActivity.set(key, snapshot);
    retainNotice(policyNotices, key, snapshot.policyNotice, (timestamp, message, id) =>
      buildSessionPolicyNoticeMessage(timestamp, message, id, snapshot.ref.runtimeKind),
    );
    retainNotice(launchFailures, key, snapshot.launchFailure, buildSessionErrorNoticeMessage);
    retainNotice(
      approvalFailures,
      key,
      snapshot.approvalPolicyFailure,
      buildSessionErrorNoticeMessage,
    );
  };
  const retainOperation = (observation: SessionOperationObservation) => {
    const key = agentSessionIdentityKey(observation.ref);
    noticeUpdates.add(key);
    const id = `host-operation:${observation.kind}:${observation.submissionId ?? "current"}`;
    const current = operations.get(key) ?? new Map<string, SessionOperationObservation>();
    if (observation.pending || observation.failure || observation.nativeOutcome === "uncertain")
      current.set(id, observation);
    else current.delete(id);
    operations.set(key, current);
    const notices = operationFailures.get(key) ?? new Map<string, AgentChatMessage>();
    if (observation.failure)
      notices.set(
        id,
        buildSessionErrorNoticeMessage(
          notices.get(id)?.timestamp ?? new Date().toISOString(),
          `${observation.failure.message} ${observation.failure.nextAction}`,
          id,
        ),
      );
    else notices.delete(id);
    operationFailures.set(key, notices);
  };
  const retainAcknowledgement = (
    ref: AgentSessionLiveRef,
    submissionId: string,
    outcome: "accepted" | "queued",
    fromSnapshot = false,
  ) => {
    if (ref.repoPath !== workspaceRepoPath) return;
    noticeUpdates.add(agentSessionIdentityKey(ref));
    const key = agentSessionRefKey(ref);
    const receipts = acknowledged.get(key) ?? new Map<string, SubmissionReceipt>();
    if (
      receipts.get(submissionId)?.outcome !== "accepted" ||
      (outcome === "accepted" && fromSnapshot)
    )
      receipts.set(submissionId, { outcome, fromSnapshot });
    acknowledged.set(key, receipts);
  };
  const retainQueueAcknowledgements = (queue: AgentMessageQueueSnapshot) => {
    for (const entry of queue.entries)
      if (entry.state === "queued" || entry.state === "editing")
        retainAcknowledgement(queue.target, entry.submissionId, "queued");
  };
  const clearLiveNotices = (key?: string): void => {
    if (key === undefined) observedActivity.clear();
    else observedActivity.delete(key);
    for (const notices of [policyNotices, launchFailures, approvalFailures]) {
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
    noticeUpdates.clear();
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
    const versions = new Map<string, SessionHistoryVersion>();
    for (const session of listAgentSessions(sessionCollection)) {
      if (session.historyLoadState !== "loaded" || session.historyLoadFailure) continue;
      const version = historyProgress?.getVersion(session);
      if (version) versions.set(agentSessionIdentityKey(session), version);
    }
    retainedHistoryVersions.set(workspaceRepoPath, versions);
    retainedCollections.set(workspaceRepoPath, markSessionHistoriesStale(sessionCollection));
  };

  const activateCollection = (repoPath: string | null): AgentSessionCollection => {
    if (repoPath === null) {
      return emptyAgentSessionCollection();
    }
    let collection = retainedCollections.get(repoPath) ?? emptyAgentSessionCollection();
    const removals = pendingTaskRemovals.get(repoPath);
    if (removals) {
      collection = withoutTasks(collection, removals);
      pendingTaskRemovals.delete(repoPath);
    }
    return collection;
  };

  return {
    listSessionTaskIds: (repoPath) => {
      const collection =
        repoPath === workspaceRepoPath ? sessionCollection : retainedCollections.get(repoPath);
      const removals = pendingTaskRemovals.get(repoPath);
      const taskIds = new Set<string>();
      for (const session of collection ? listAgentSessions(collection) : []) {
        const association = session.sessionAssociation;
        if (association.kind === "workflow" && !removals?.has(association.taskId)) {
          taskIds.add(association.taskId);
        }
      }
      return [...taskIds];
    },
    removeTaskSessions: (repoPath, taskIds) => {
      if (taskIds.length === 0) return;
      if (repoPath === workspaceRepoPath) {
        setSessionCollection((current) => withoutTasks(current, new Set(taskIds)));
        return;
      }
      // Inactive collections have no writer. Save removals until the next workspace switch.
      const removals = pendingTaskRemovals.get(repoPath) ?? new Set<string>();
      for (const taskId of taskIds) removals.add(taskId);
      pendingTaskRemovals.set(repoPath, removals);
    },
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
    recordHistoryEnvelope: (envelope) => historyProgress?.recordEvent(envelope),
    applyLiveSessionEnvelope: (envelope) => {
      switch (envelope.type) {
        case "snapshot": {
          if (envelope.repoPath !== workspaceRepoPath) return;
          // Recheck when attachment completes: events may arrive after workspace activation.
          const versions = retainedHistoryVersions.get(envelope.repoPath);
          retainedHistoryVersions.delete(envelope.repoPath);
          if (versions || (envelope.isConnectionSnapshot && historyFreshness)) {
            setSessionCollection((current) => {
              let collection = current;
              for (const session of listAgentSessions(current)) {
                const version = versions?.get(agentSessionIdentityKey(session));
                if (
                  session.historyLoadState === "stale" &&
                  !envelope.historyReplayGap &&
                  version &&
                  historyFreshness?.isCurrent(envelope.repoPath, session, version)
                ) {
                  historyProgress?.restoreVersion(session, version);
                  collection = replaceAgentSession(collection, {
                    ...session,
                    historyLoadState: "loaded",
                  });
                } else if (
                  envelope.isConnectionSnapshot &&
                  historyFreshness &&
                  (envelope.historyReplayGap ||
                    !historyFreshness.isCurrent(
                      envelope.repoPath,
                      session,
                      historyProgress?.getVersion(session) ?? null,
                    ))
                ) {
                  // The rail can advance while this observer is detached. A snapshot has no transcript.
                  collection = replaceAgentSession(collection, markSessionHistoryStale(session));
                }
              }
              return collection;
            });
          }
          for (const key of sessionCollection.keys()) noticeUpdates.add(key);
          clearLiveNotices();
          operations.clear();
          operationFailures.clear();
          // Snapshot absence cannot undo a known admission, including a removed queue entry.
          for (const snapshot of envelope.sessions) retainLiveNotices(snapshot);
          for (const observation of envelope.sessionOperations ?? []) retainOperation(observation);
          for (const acknowledgement of envelope.submissionAcknowledgements ?? []) {
            retainAcknowledgement(
              acknowledgement.ref,
              acknowledgement.submissionId,
              "accepted",
              true,
            );
          }
          for (const queue of envelope.messageQueues) retainQueueAcknowledgements(queue);
          return;
        }
        case "session_operation_updated":
          if (envelope.observation.ref.repoPath === workspaceRepoPath)
            retainOperation(envelope.observation);
          return;
        case "submission_acknowledged": {
          retainAcknowledgement(
            envelope.acknowledgement.ref,
            envelope.acknowledgement.submissionId,
            "accepted",
          );
          return;
        }
        case "message_queue_updated":
          retainQueueAcknowledgements(envelope.queue);
          return;
        case "session_upsert":
          if (envelope.session.ref.repoPath !== workspaceRepoPath) return;
          retainLiveNotices(envelope.session);
          return;
        case "session_removed":
          if (envelope.ref.repoPath !== workspaceRepoPath) return;
          noticeUpdates.add(agentSessionIdentityKey(envelope.ref));
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

      if (
        workspaceRepoPath &&
        nextSession.historyLoadState !== current.historyLoadState &&
        (nextSession.historyLoadState === "loading" ||
          nextSession.historyLoadState === "refreshing")
      ) {
        // Pin the full read's starting position, never the rail's position at departure.
        historyProgress?.captureReadVersion(workspaceRepoPath, nextSession);
      }

      setSessionCollection((current) =>
        replaceAgentSessionByIdentity(current, identity, nextSession),
      );
      return getAgentSession(sessionCollection, nextSession);
    },
    resetWorkspace: (nextWorkspaceRepoPath) => {
      retainActiveCollection();
      noticeUpdates.clear();
      historyProgress?.reset();
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

function withoutTasks(
  collection: AgentSessionCollection,
  taskIds: Set<string>,
): AgentSessionCollection {
  let next = collection;
  for (const session of listAgentSessions(collection)) {
    if (
      session.sessionAssociation.kind === "workflow" &&
      taskIds.has(session.sessionAssociation.taskId)
    )
      next = removeAgentSession(next, session);
  }
  return next;
}

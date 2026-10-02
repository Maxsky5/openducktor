import type {
  AgentSessionLiveEnvelope,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  AgentSessionScope,
  NotificationOccurrence,
} from "@openducktor/contracts";
import { agentSessionRefKey, normalizeSessionErrorMessage } from "@openducktor/core";
import { pendingInputIdentity } from "./pending-input-identity";
import {
  createSessionNotificationBuilder,
  toNotificationStatus,
} from "./session-notification-builder";

type CreateSessionOccurrenceProjectorOptions = {
  repositoryLabel: string;
  resolveAssociation(ref: AgentSessionLiveSnapshot["ref"]): AgentSessionScope | null;
  resolveTask(taskId: string): { id: string; title?: string } | null;
};

type SessionProjection = {
  association: AgentSessionScope | null;
  snapshot: AgentSessionLiveSnapshot;
  executionEpisodeId: string | undefined;
  errorNotified: boolean;
  idleNotified: boolean;
  lastAssistantMessage: { id: string; text: string } | null;
  pendingApprovals: Set<string>;
  pendingQuestions: Set<string>;
  running: boolean;
  unownedInputs: UnownedPendingInputs | null;
  unownedTerminals: Map<string, NotificationOccurrence>;
  childQuestions: Map<string, AgentSessionLivePendingQuestionRequest>;
};

type UnownedPendingInputs = {
  approvals: Set<string>;
  questions: Set<string>;
  liveApprovals: Set<string>;
  liveQuestions: Set<string>;
};

/**
 * Keep live requests until their session has an owner. Baselines seed state without
 * new alerts, and execution episode IDs prevent repeated idle and error alerts.
 */
export const createSessionOccurrenceProjector = ({
  repositoryLabel,
  resolveAssociation,
  resolveTask,
}: CreateSessionOccurrenceProjectorOptions) => {
  const { sessionOccurrence, sessionTarget, projectPendingInput, setRepositoryLabel } =
    createSessionNotificationBuilder({ repositoryLabel, resolveTask });
  const sessions = new Map<string, SessionProjection>();

  const observeUnownedInputs = (projection: SessionProjection, live: boolean): void => {
    const { snapshot } = projection;
    if (snapshot.parentExternalSessionId !== undefined) {
      projection.unownedInputs = null;
      return;
    }
    const previous = projection.unownedInputs;
    const approvals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
    const questions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
    projection.unownedInputs = {
      approvals,
      questions,
      liveApprovals: new Set(
        [...approvals].filter(
          (id) => previous?.liveApprovals.has(id) || (live && !previous?.approvals.has(id)),
        ),
      ),
      liveQuestions: new Set(
        [...questions].filter(
          (id) => previous?.liveQuestions.has(id) || (live && !previous?.questions.has(id)),
        ),
      ),
    };
  };

  const publishTerminal = (
    projection: SessionProjection,
    occurrence: NotificationOccurrence,
  ): NotificationOccurrence[] => {
    if (projection.association) return [occurrence];
    // One entry per episode also lets an error replace a deferred idle notice.
    projection.unownedTerminals.set(executionEpisodeId(projection), occurrence);
    return [];
  };

  const flushOwnedTerminals = (projection: SessionProjection): NotificationOccurrence[] => {
    if (projection.snapshot.parentExternalSessionId !== undefined) {
      projection.unownedInputs = null;
      projection.unownedTerminals.clear();
      return [];
    }
    if (!projection.association) return [];
    const terminals = [...projection.unownedTerminals.values()];
    projection.unownedTerminals.clear();
    if (projection.association.kind === "repository") return terminals;
    const { taskId, role } = projection.association;
    return terminals.map((occurrence) => ({
      ...occurrence,
      task: resolveTask(taskId) ?? { id: taskId },
      role,
      navigationTarget: { ...occurrence.navigationTarget, taskId },
    }));
  };

  const finishIdleCycle = (projection: SessionProjection): NotificationOccurrence[] => {
    if (!projection.running || projection.errorNotified || projection.idleNotified) {
      return [];
    }
    projection.running = false;
    projection.idleNotified = true;
    return publishTerminal(
      projection,
      sessionOccurrence(projection, {
        kind: "agent.session_idle",
        suffix: executionEpisodeId(projection),
        status: projection.lastAssistantMessage?.text ?? "Ready for your next message.",
        navigationTarget: { type: "agent_session", ...sessionTarget(projection) },
      }),
    );
  };

  const finishErrorEpisode = (
    projection: SessionProjection,
    errorId: string,
    message: string,
  ): NotificationOccurrence[] => {
    if (projection.errorNotified) {
      return [];
    }
    projection.running = false;
    projection.errorNotified = true;
    return publishTerminal(
      projection,
      sessionOccurrence(projection, {
        kind: "agent.session_error",
        suffix: executionEpisodeId(projection),
        status:
          toNotificationStatus(normalizeSessionErrorMessage(message)) ||
          "The session failed. Open it for details.",
        navigationTarget: { type: "session_error", ...sessionTarget(projection), errorId },
      }),
    );
  };

  const findOwnedAncestor = (snapshot: AgentSessionLiveSnapshot): SessionProjection | null => {
    let parentExternalSessionId = snapshot.parentExternalSessionId;
    const visited = new Set([snapshot.ref.externalSessionId]);
    while (parentExternalSessionId && !visited.has(parentExternalSessionId)) {
      visited.add(parentExternalSessionId);
      const parent = sessions.get(
        agentSessionRefKey({
          ...snapshot.ref,
          externalSessionId: parentExternalSessionId,
        }),
      );
      if (!parent) return null;
      if (parent.association) return parent;
      parentExternalSessionId = parent.snapshot.parentExternalSessionId;
    }
    return null;
  };

  const projectChildBackgroundQuestions = (
    projection: SessionProjection,
    previousQuestions: ReadonlySet<string>,
  ): NotificationOccurrence[] => {
    const { snapshot } = projection;
    if (!snapshot.parentExternalSessionId) return [];
    const pending = pendingRequestsByIdentity(snapshot.pendingQuestions);
    const deferred = projection.childQuestions;
    for (const identity of deferred.keys()) {
      const request = pending.get(identity);
      if (!request || request.blocking !== false) deferred.delete(identity);
    }
    for (const [identity, request] of pending) {
      if (request.blocking === false && !previousQuestions.has(identity)) {
        deferred.set(identity, request);
      }
    }
    if (deferred.size === 0) return [];
    const owner = findOwnedAncestor(snapshot);
    if (!owner) return [];

    const requests = [...deferred.values()];
    deferred.clear();
    return requests.map((request) =>
      projectPendingInput(owner, { inputKind: "question", request }),
    );
  };

  const projectDeferredChildQuestions = (): NotificationOccurrence[] => {
    const occurrences: NotificationOccurrence[] = [];
    for (const child of sessions.values()) {
      if (child.childQuestions.size > 0)
        occurrences.push(...projectChildBackgroundQuestions(child, child.pendingQuestions));
    }
    return occurrences;
  };

  const applyUpsert = (
    snapshot: AgentSessionLiveSnapshot,
    live = true,
  ): NotificationOccurrence[] => {
    const key = agentSessionRefKey(snapshot.ref);
    const association = resolveAssociation(snapshot.ref);
    const previous = sessions.get(key);
    const projection = previous ?? createProjection(snapshot, association);
    projection.snapshot = snapshot;
    if (!association) {
      if (previous?.association) {
        projection.unownedInputs = {
          approvals: previous.pendingApprovals,
          questions: previous.pendingQuestions,
          liveApprovals: new Set(),
          liveQuestions: new Set(),
        };
      }
      observeUnownedInputs(projection, live);
    }
    if (!previous) {
      sessions.set(key, projection);
      if (!live) return projectDeferredChildQuestions();
      if (association && snapshot.parentExternalSessionId === undefined) {
        projection.pendingApprovals.clear();
        projection.pendingQuestions.clear();
        return applyUpsert(snapshot);
      }
      if (snapshot.parentExternalSessionId !== undefined) {
        return [
          ...projectChildBackgroundQuestions(projection, new Set()),
          ...projectDeferredChildQuestions(),
        ];
      }
      return [
        ...(association ? flushOwnedInputs(projection) : []),
        ...projectDeferredChildQuestions(),
      ];
    }

    const ownershipResolved = !projection.association && association !== null;
    projection.association = association;
    if (projection.executionEpisodeId !== snapshot.executionEpisodeId) {
      projection.executionEpisodeId = snapshot.executionEpisodeId;
      projection.errorNotified = false;
      projection.idleNotified = false;
      projection.lastAssistantMessage = null;
      projection.running = false;
    }
    if (!live) {
      projection.pendingApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
      projection.pendingQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
      return [
        ...flushOwnedInputs(projection),
        ...flushOwnedTerminals(projection),
        ...projectDeferredChildQuestions(),
      ];
    }
    if (projection.snapshot.parentExternalSessionId !== undefined) {
      projection.unownedInputs = null;
      projection.unownedTerminals.clear();
      const occurrences = projectChildBackgroundQuestions(projection, projection.pendingQuestions);
      projection.pendingApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
      projection.pendingQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
      return [...occurrences, ...projectDeferredChildQuestions()];
    }

    const occurrences: NotificationOccurrence[] = [];
    if (ownershipResolved) {
      observeUnownedInputs(projection, live);
      projection.pendingApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
      projection.pendingQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
      occurrences.push(...flushOwnedInputs(projection));
    }
    const nextApprovals = pendingRequestsByIdentity(snapshot.pendingApprovals);
    const nextQuestions = pendingRequestsByIdentity(snapshot.pendingQuestions);
    for (const [identity, request] of nextApprovals) {
      if (association && !projection.pendingApprovals.has(identity)) {
        occurrences.push(projectPendingInput(projection, { inputKind: "permission", request }));
      }
    }
    for (const [identity, request] of nextQuestions) {
      if (association && !projection.pendingQuestions.has(identity)) {
        occurrences.push(projectPendingInput(projection, { inputKind: "question", request }));
      }
    }
    projection.pendingApprovals = new Set(nextApprovals.keys());
    projection.pendingQuestions = new Set(nextQuestions.keys());

    if (snapshot.activity !== "idle" && !projection.errorNotified && !projection.idleNotified) {
      projection.running = true;
    }
    return [...flushOwnedTerminals(projection), ...occurrences, ...projectDeferredChildQuestions()];
  };

  const flushOwnedInputs = (projection: SessionProjection): NotificationOccurrence[] => {
    const { snapshot } = projection;
    if (!projection.association) return [];
    const pending = projection.unownedInputs;
    projection.unownedInputs = null;
    if (!pending || projection.snapshot.parentExternalSessionId !== undefined) return [];
    const occurrences: NotificationOccurrence[] = [];
    for (const [identity, request] of pendingRequestsByIdentity(snapshot.pendingApprovals)) {
      if (pending.liveApprovals.has(identity)) {
        occurrences.push(projectPendingInput(projection, { inputKind: "permission", request }));
      }
    }
    for (const [identity, request] of pendingRequestsByIdentity(snapshot.pendingQuestions)) {
      if (pending.liveQuestions.has(identity)) {
        occurrences.push(projectPendingInput(projection, { inputKind: "question", request }));
      }
    }
    return occurrences;
  };

  const applyTranscriptEvent = (event: AgentSessionTranscriptEvent): NotificationOccurrence[] => {
    const projection = sessions.get(agentSessionRefKey(event.sessionRef));
    if (!projection || projection.snapshot.parentExternalSessionId !== undefined) {
      return [];
    }

    if (event.type === "assistant_message") {
      const message = toNotificationStatus(event.message);
      if (projection.running && message) {
        projection.lastAssistantMessage = { id: event.messageId, text: message };
      }
      return [];
    }
    if (
      event.type === "transcript_retracted" &&
      projection.lastAssistantMessage &&
      event.messageIds.includes(projection.lastAssistantMessage.id)
    ) {
      projection.lastAssistantMessage = null;
      return [];
    }
    if (event.type === "session_status") {
      if (event.status.type === "idle") {
        return finishIdleCycle(projection);
      }
      return [];
    }
    if (event.type === "session_idle") {
      return finishIdleCycle(projection);
    }
    if (event.type === "session_finished") {
      if (isExpectedUserStop(event)) {
        projection.running = false;
        return [];
      }
      return finishIdleCycle(projection);
    }
    if (event.type === "turn_error" || event.type === "session_error") {
      return finishErrorEpisode(projection, event.timestamp, event.message);
    }
    return [];
  };

  return {
    invalidateOwnership(rootKey: string) {
      const removed = new Set([rootKey]);
      for (const [key, projection] of sessions) {
        let parent = projection.snapshot.parentExternalSessionId;
        const visited = new Set<string>();
        while (parent && !visited.has(parent)) {
          visited.add(parent);
          const parentKey = agentSessionRefKey({
            ...projection.snapshot.ref,
            externalSessionId: parent,
          });
          if (parentKey === rootKey) {
            removed.add(key);
            break;
          }
          parent = sessions.get(parentKey)?.snapshot.parentExternalSessionId;
        }
      }
      for (const key of removed) {
        const projection = sessions.get(key);
        if (projection) {
          clearDeferred(projection);
          projection.association = null;
        }
      }
    },
    setRepositoryLabel,
    reconcileAssociations(): NotificationOccurrence[] {
      return [...sessions.values()].flatMap((projection) =>
        applyUpsert(projection.snapshot, false),
      );
    },
    accept(
      envelope: AgentSessionLiveEnvelope,
      provenance: "live" | "baseline" = "live",
    ): NotificationOccurrence[] {
      if (envelope.type === "snapshot") {
        const previousSessions = new Map(sessions);
        sessions.clear();
        const occurrences: NotificationOccurrence[] = [];
        for (const snapshot of envelope.sessions) {
          const key = agentSessionRefKey(snapshot.ref);
          const association = resolveAssociation(snapshot.ref);
          const projection = createProjection(snapshot, association);
          const previous = previousSessions.get(key);
          if (previous) {
            projection.childQuestions = previous.childQuestions;
            if (!envelope.isConnectionSnapshot) {
              projection.unownedInputs = previous.unownedInputs;
              projection.unownedTerminals = previous.unownedTerminals;
            }
          }
          if (
            !envelope.isConnectionSnapshot &&
            previous &&
            previous.executionEpisodeId === projection.executionEpisodeId
          ) {
            projection.errorNotified = previous.errorNotified;
            projection.idleNotified = previous.idleNotified;
            projection.lastAssistantMessage = previous.lastAssistantMessage;
            projection.running = previous.running;
          }
          sessions.set(key, projection);
          if (association) {
            occurrences.push(...flushOwnedInputs(projection));
          } else {
            observeUnownedInputs(projection, false);
          }
          occurrences.push(...flushOwnedTerminals(projection));
        }
        occurrences.push(...projectDeferredChildQuestions());
        return occurrences;
      }
      if (envelope.type === "session_upsert") {
        return applyUpsert(envelope.session, provenance === "live");
      }
      if (envelope.type === "session_removed") {
        // A runtime can return later. Keep live child questions until their ancestor returns.
        const key = agentSessionRefKey(envelope.ref);
        sessions.delete(key);
        return [];
      }
      if (envelope.type === "transcript_event") {
        return provenance === "live" ? applyTranscriptEvent(envelope.event) : [];
      }
      return [];
    },
  };
};

const createProjection = (
  snapshot: AgentSessionLiveSnapshot,
  association: AgentSessionScope | null,
): SessionProjection => ({
  association,
  snapshot,
  executionEpisodeId: snapshot.executionEpisodeId,
  errorNotified: false,
  idleNotified: false,
  lastAssistantMessage: null,
  pendingApprovals: new Set(snapshot.pendingApprovals.map(pendingInputIdentity)),
  pendingQuestions: new Set(snapshot.pendingQuestions.map(pendingInputIdentity)),
  running: snapshot.activity !== "idle",
  unownedInputs: null,
  unownedTerminals: new Map(),
  childQuestions: new Map(),
});

const clearDeferred = (projection: SessionProjection): void => {
  projection.unownedInputs = null;
  projection.unownedTerminals.clear();
  projection.childQuestions.clear();
};

const isExpectedUserStop = (
  event: Extract<AgentSessionTranscriptEvent, { type: "session_finished" }>,
): boolean => {
  const message = event.message.trim().toLowerCase();
  return message === "session stopped" || message === "runtime stopped";
};

const pendingRequestsByIdentity = <Request extends { requestId: string }>(requests: Request[]) =>
  new Map(requests.map((request) => [pendingInputIdentity(request), request]));

const executionEpisodeId = (projection: SessionProjection): string => {
  if (!projection.executionEpisodeId) {
    throw new Error("The live Agent Session has no execution episode ID. Reload to reconnect.");
  }
  return projection.executionEpisodeId;
};

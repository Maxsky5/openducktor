import { normalizeSessionErrorMessage } from "@/lib/session-error-message";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  AgentSessionWorkflowScope,
  NotificationNavigationTarget,
  NotificationOccurrence,
  NotificationSessionIdentity,
} from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { pendingInputIdentity } from "@/lib/pending-input-identity";

type NotificationTaskIdentity = {
  id: string;
  title?: string;
};

type CreateSessionOccurrenceProjectorOptions = {
  repositoryLabel: string;
  resolveAssociation(ref: AgentSessionLiveSnapshot["ref"]): AgentSessionWorkflowScope | null;
  resolveTask(taskId: string): NotificationTaskIdentity | null;
};

type SessionProjection = {
  association: AgentSessionWorkflowScope | null;
  executionEpisodeId: string | undefined;
  errorNotified: boolean;
  idleNotified: boolean;
  isSubagent: boolean;
  lastAssistantMessage: { id: string; text: string } | null;
  pendingApprovals: Set<string>;
  pendingQuestions: Set<string>;
  running: boolean;
  ref: AgentSessionLiveSnapshot["ref"];
};

type UnownedPendingInputs = {
  approvals: Set<string>;
  questions: Set<string>;
  liveApprovals: Set<string>;
  liveQuestions: Set<string>;
};

const toSessionIdentity = (ref: AgentSessionLiveSnapshot["ref"]): NotificationSessionIdentity => ({
  externalSessionId: ref.externalSessionId,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
});

const createProjection = (
  snapshot: AgentSessionLiveSnapshot,
  association: AgentSessionWorkflowScope | null,
): SessionProjection => ({
  association,
  executionEpisodeId: snapshot.executionEpisodeId,
  errorNotified: false,
  idleNotified: false,
  isSubagent: snapshot.parentExternalSessionId !== undefined,
  lastAssistantMessage: null,
  pendingApprovals: new Set(snapshot.pendingApprovals.map(pendingInputIdentity)),
  pendingQuestions: new Set(snapshot.pendingQuestions.map(pendingInputIdentity)),
  running: snapshot.activity !== "idle",
  ref: snapshot.ref,
});

const isExpectedUserStop = (
  event: Extract<AgentSessionTranscriptEvent, { type: "session_finished" }>,
): boolean => {
  const message = event.message.trim().toLowerCase();
  return message === "session stopped" || message === "runtime stopped";
};

const toNotificationStatus = (message: string): string =>
  message.trim().replace(/\s+/g, " ").slice(0, 240);

const pendingRequestsByIdentity = <Request extends { requestId: string }>(requests: Request[]) =>
  new Map(requests.map((request) => [pendingInputIdentity(request), request]));

const permissionStatus = (request: AgentSessionLivePendingApprovalRequest): string => {
  const summary = request.summary?.trim() || request.title.trim();
  const action =
    request.command?.command ??
    request.action?.description ??
    request.action?.name ??
    request.tool?.title ??
    request.tool?.name;
  return (
    toNotificationStatus([summary, action].filter(Boolean).join(": ")) ||
    "Approval is needed to continue."
  );
};

const questionStatus = (request: AgentSessionLivePendingQuestionRequest): string => {
  const question = request.questions[0]?.question.trim() || "Your answer is needed to continue.";
  const remaining = request.questions.length - 1;
  const suffix = remaining > 0 ? ` +${remaining} more question${remaining === 1 ? "" : "s"}` : "";
  return `${toNotificationStatus(question).slice(0, 240 - suffix.length)}${suffix}`;
};

const executionEpisodeId = (projection: SessionProjection): string => {
  if (!projection.executionEpisodeId) {
    throw new Error("The live Agent Session has no execution episode ID. Reload to reconnect.");
  }
  return projection.executionEpisodeId;
};

export const createSessionOccurrenceProjector = ({
  repositoryLabel,
  resolveAssociation,
  resolveTask,
}: CreateSessionOccurrenceProjectorOptions) => {
  const sessions = new Map<string, SessionProjection>();
  const unownedInputs = new Map<string, UnownedPendingInputs>();
  const unownedTerminals = new Map<string, Map<string, NotificationOccurrence>>();

  const observeUnownedInputs = (snapshot: AgentSessionLiveSnapshot, live: boolean): void => {
    const key = agentSessionIdentityKey(snapshot.ref);
    if (snapshot.parentExternalSessionId !== undefined) {
      unownedInputs.delete(key);
      return;
    }
    const previous = unownedInputs.get(key);
    const approvals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
    const questions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
    unownedInputs.set(key, {
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
    });
  };

  const sessionOccurrence = (
    projection: SessionProjection,
    input: {
      kind:
        | "agent.permission_requested"
        | "agent.question_asked"
        | "agent.session_error"
        | "agent.session_idle";
      suffix: string;
      status: string;
      navigationTarget: NotificationNavigationTarget;
    },
  ): NotificationOccurrence => {
    const occurrence: NotificationOccurrence = {
      occurrenceId: `${input.kind}:${agentSessionIdentityKey(projection.ref)}:${input.suffix}`,
      kind: input.kind,
      repoPath: projection.ref.repoPath,
      repositoryLabel,
      status: input.status,
      navigationTarget: input.navigationTarget,
    };
    if (projection.association) {
      const taskId = projection.association.taskId;
      occurrence.task = resolveTask(taskId) ?? { id: taskId };
      occurrence.role = projection.association.role;
    }
    return occurrence;
  };

  const sessionTarget = (
    projection: SessionProjection,
  ): Omit<Extract<NotificationNavigationTarget, { type: "agent_session" }>, "type"> => {
    const target: Omit<Extract<NotificationNavigationTarget, { type: "agent_session" }>, "type"> = {
      repoPath: projection.ref.repoPath,
      session: toSessionIdentity(projection.ref),
    };
    if (projection.association) target.taskId = projection.association.taskId;
    return target;
  };

  const publishTerminal = (
    projection: SessionProjection,
    occurrence: NotificationOccurrence,
  ): NotificationOccurrence[] => {
    if (projection.association) return [occurrence];
    const key = agentSessionIdentityKey(projection.ref);
    let terminals = unownedTerminals.get(key);
    if (!terminals) {
      terminals = new Map();
      unownedTerminals.set(key, terminals);
    }
    // One entry per episode also lets an error replace a deferred idle notice.
    terminals.set(executionEpisodeId(projection), occurrence);
    return [];
  };

  const reconcileTerminalOwnership = (projection: SessionProjection): NotificationOccurrence[] => {
    const key = agentSessionIdentityKey(projection.ref);
    if (projection.isSubagent) {
      unownedInputs.delete(key);
      unownedTerminals.delete(key);
      return [];
    }
    if (!projection.association) return [];
    const terminals = unownedTerminals.get(key);
    unownedTerminals.delete(key);
    if (!terminals) return [];
    const { taskId, role } = projection.association;
    return [...terminals.values()].map((occurrence) => ({
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

  const projectPendingInput = (
    projection: SessionProjection,
    input:
      | { inputKind: "permission"; request: AgentSessionLivePendingApprovalRequest }
      | { inputKind: "question"; request: AgentSessionLivePendingQuestionRequest },
  ): NotificationOccurrence => {
    const requestIdentity = pendingInputIdentity(input.request);
    const kind =
      input.inputKind === "permission" ? "agent.permission_requested" : "agent.question_asked";
    const status =
      input.inputKind === "permission"
        ? permissionStatus(input.request)
        : questionStatus(input.request);
    return sessionOccurrence(projection, {
      kind,
      suffix: requestIdentity,
      status,
      navigationTarget: {
        type: "pending_input",
        ...sessionTarget(projection),
        inputKind: input.inputKind,
        requestId: requestIdentity,
      },
    });
  };

  const applyUpsert = (snapshot: AgentSessionLiveSnapshot): NotificationOccurrence[] => {
    const key = agentSessionIdentityKey(snapshot.ref);
    const association = resolveAssociation(snapshot.ref);
    if (!association) {
      const previous = sessions.get(key);
      if (previous?.association) {
        unownedInputs.set(key, {
          approvals: previous.pendingApprovals,
          questions: previous.pendingQuestions,
          liveApprovals: new Set(),
          liveQuestions: new Set(),
        });
      }
      observeUnownedInputs(snapshot, true);
    }
    const projection = sessions.get(key);
    if (!projection) {
      if (unownedInputs.has(key)) observeUnownedInputs(snapshot, true);
      const owned = createProjection(snapshot, association);
      sessions.set(key, owned);
      return association ? reconcilePendingOwnership(owned, snapshot) : [];
    }

    const ownershipResolved = !projection.association && association !== null;
    projection.association = association;
    projection.isSubagent = snapshot.parentExternalSessionId !== undefined;
    projection.ref = snapshot.ref;
    if (projection.executionEpisodeId !== snapshot.executionEpisodeId) {
      projection.executionEpisodeId = snapshot.executionEpisodeId;
      projection.errorNotified = false;
      projection.idleNotified = false;
      projection.lastAssistantMessage = null;
      projection.running = false;
    }
    if (projection.isSubagent) {
      unownedInputs.delete(key);
      unownedTerminals.delete(key);
      projection.pendingApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
      projection.pendingQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
      return [];
    }

    const occurrences: NotificationOccurrence[] = [];
    if (ownershipResolved) {
      observeUnownedInputs(snapshot, true);
      projection.pendingApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
      projection.pendingQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
      occurrences.push(...reconcilePendingOwnership(projection, snapshot));
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
    return [...reconcileTerminalOwnership(projection), ...occurrences];
  };

  const reconcilePendingOwnership = (
    projection: SessionProjection,
    snapshot: AgentSessionLiveSnapshot,
  ): NotificationOccurrence[] => {
    const key = agentSessionIdentityKey(projection.ref);
    const pending = unownedInputs.get(key);
    unownedInputs.delete(key);
    if (!pending || projection.isSubagent) return [];
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
    const projection = sessions.get(agentSessionIdentityKey(event.sessionRef));
    if (!projection || projection.isSubagent) {
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
    accept(envelope: AgentSessionLiveEnvelope): NotificationOccurrence[] {
      if (envelope.type === "snapshot") {
        if (envelope.isConnectionSnapshot) {
          unownedInputs.clear();
          unownedTerminals.clear();
        }
        const previousSessions = new Map(sessions);
        sessions.clear();
        const retained = new Set<string>();
        const occurrences: NotificationOccurrence[] = [];
        for (const snapshot of envelope.sessions) {
          const key = agentSessionIdentityKey(snapshot.ref);
          retained.add(key);
          const association = resolveAssociation(snapshot.ref);
          const projection = createProjection(snapshot, association);
          const previous = previousSessions.get(key);
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
            occurrences.push(...reconcilePendingOwnership(projection, snapshot));
          } else {
            observeUnownedInputs(snapshot, false);
          }
          occurrences.push(...reconcileTerminalOwnership(projection));
        }
        for (const key of unownedInputs.keys()) {
          if (!retained.has(key)) unownedInputs.delete(key);
        }
        for (const key of unownedTerminals.keys()) {
          if (!retained.has(key)) unownedTerminals.delete(key);
        }
        return occurrences;
      }
      if (envelope.type === "session_upsert") {
        return applyUpsert(envelope.session);
      }
      if (envelope.type === "session_removed") {
        sessions.delete(agentSessionIdentityKey(envelope.ref));
        unownedInputs.delete(agentSessionIdentityKey(envelope.ref));
        unownedTerminals.delete(agentSessionIdentityKey(envelope.ref));
        return [];
      }
      if (envelope.type === "transcript_event") {
        return applyTranscriptEvent(envelope.event);
      }
      return [];
    },
  };
};

import type {
  AgentSessionAssociation,
  AgentSessionLiveEnvelope,
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import {
  agentSessionStatusFromActivity,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type {
  AgentApprovalRequest,
  AgentPendingInputSource,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionRuntimeTarget,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { toPersistedSessionIdentity, toPersistedSessionView } from "../support/persistence";
import { isWorkflowAgentSession } from "../support/workflow-session";
import type { TaskSessionRecords } from "./task-session-records";

type LiveProjectionEnvelope = Extract<
  AgentSessionLiveEnvelope,
  { type: "session_upsert" | "session_removed" }
>;

const toSessionIdentity = (ref: AgentSessionLiveRef): AgentSessionIdentity => ({
  externalSessionId: ref.externalSessionId,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
});

const isTerminalSessionStatus = (status: AgentSessionState["status"]): boolean =>
  status === "stopped" || status === "error";

const projectObservedSessionActivity = (
  current: Pick<AgentSessionState, "status" | "pendingUserMessageStartedAt">,
  observedStatus: AgentSessionState["status"],
): Pick<AgentSessionState, "status" | "pendingUserMessageStartedAt"> => {
  if (isTerminalSessionStatus(current.status)) {
    return { status: current.status, pendingUserMessageStartedAt: undefined };
  }
  if (observedStatus !== "idle") {
    return {
      status: observedStatus,
      pendingUserMessageStartedAt: current.pendingUserMessageStartedAt,
    };
  }
  if (current.status === "starting") {
    return current;
  }
  if (current.pendingUserMessageStartedAt !== undefined) {
    return { status: "running", pendingUserMessageStartedAt: current.pendingUserMessageStartedAt };
  }
  return { status: "idle", pendingUserMessageStartedAt: undefined };
};

const settleAbsentSessionActivity = (
  current: Pick<AgentSessionState, "status" | "pendingUserMessageStartedAt">,
): Pick<AgentSessionState, "status" | "pendingUserMessageStartedAt"> => {
  if (
    current.pendingUserMessageStartedAt === undefined ||
    current.status === "starting" ||
    isTerminalSessionStatus(current.status)
  ) {
    return projectObservedSessionActivity(current, "idle");
  }
  return { status: "idle", pendingUserMessageStartedAt: undefined };
};

type PendingInputRouting = {
  source: AgentPendingInputSource;
  responseSession: AgentSessionRuntimeTarget;
};

const toApprovalRequest = (
  request: AgentSessionLivePendingApprovalRequest,
  routing?: PendingInputRouting,
): AgentApprovalRequest => ({
  requestId: request.requestId,
  requestType: request.requestType,
  title: request.title,
  ...(request.summary !== undefined ? { summary: request.summary } : undefined),
  ...(request.details !== undefined ? { details: request.details } : undefined),
  ...(request.affectedPaths !== undefined ? { affectedPaths: request.affectedPaths } : undefined),
  ...(request.command !== undefined
    ? {
        command: {
          command: request.command.command,
          ...(request.command.workingDirectory !== undefined
            ? { workingDirectory: request.command.workingDirectory }
            : undefined),
        },
      }
    : undefined),
  ...(request.action !== undefined
    ? {
        action: {
          name: request.action.name,
          ...(request.action.description !== undefined
            ? { description: request.action.description }
            : undefined),
        },
      }
    : undefined),
  ...(request.tool !== undefined
    ? {
        tool: {
          name: request.tool.name,
          ...(request.tool.title !== undefined ? { title: request.tool.title } : undefined),
          ...(request.tool.input !== undefined ? { input: request.tool.input } : undefined),
        },
      }
    : undefined),
  ...(request.mutation !== undefined ? { mutation: request.mutation } : undefined),
  ...(request.supportedReplyOutcomes !== undefined
    ? { supportedReplyOutcomes: request.supportedReplyOutcomes }
    : undefined),
  ...routing,
});

const toQuestionRequest = (
  request: AgentSessionLivePendingQuestionRequest,
  routing?: PendingInputRouting,
): AgentQuestionRequest => ({
  requestId: request.requestId,
  questions: request.questions.map((question) => ({
    header: question.header,
    question: question.question,
    options: question.options,
    ...(question.multiple !== undefined ? { multiple: question.multiple } : undefined),
    ...(question.custom !== undefined ? { custom: question.custom } : undefined),
  })),
  ...routing,
});

export const toContextUsage = (
  contextUsage: AgentSessionLiveSnapshot["contextUsage"],
): Exclude<AgentSessionState["contextUsage"], undefined> =>
  contextUsage === null
    ? null
    : {
        totalTokens: contextUsage.totalTokens,
        ...(contextUsage.contextWindow !== undefined
          ? { contextWindow: contextUsage.contextWindow }
          : undefined),
        ...(contextUsage.outputLimit !== undefined
          ? { outputLimit: contextUsage.outputLimit }
          : undefined),
        ...(contextUsage.providerId !== undefined
          ? { providerId: contextUsage.providerId }
          : undefined),
        ...(contextUsage.modelId !== undefined ? { modelId: contextUsage.modelId } : undefined),
        ...(contextUsage.variant !== undefined ? { variant: contextUsage.variant } : undefined),
        ...(contextUsage.profileId !== undefined
          ? { profileId: contextUsage.profileId }
          : undefined),
      };

const applyDirectSnapshot = (
  current: AgentSessionState,
  snapshot: AgentSessionLiveSnapshot,
): AgentSessionState => {
  const transition = resolveAgentSessionAssociationTransition(
    current.sessionAssociation,
    snapshot.sessionAssociation,
  );
  if (transition.kind === "conflict") {
    throw new Error(
      `Cannot apply live snapshot for session '${current.externalSessionId}' because its registered ${describeAgentSessionScope(transition.previous)} does not match the incoming ${describeAgentSessionScope(transition.incoming)}.`,
    );
  }
  const sessionAssociation = sameSessionAssociation(
    current.sessionAssociation,
    transition.association,
  )
    ? current.sessionAssociation
    : transition.association;
  if (isTerminalSessionStatus(current.status)) {
    return {
      ...current,
      sessionAssociation,
      liveParentExternalSessionId: snapshot.parentExternalSessionId,
      pendingApprovals: [],
      pendingQuestions: [],
      pendingUserMessageStartedAt: undefined,
      runtimeStatusMessage: null,
    };
  }
  const snapshotStatus = agentSessionStatusFromActivity(snapshot.activity);
  const activity = projectObservedSessionActivity(current, snapshotStatus);
  const directApprovals = snapshot.pendingApprovals.map((request) => toApprovalRequest(request));
  const directQuestions = snapshot.pendingQuestions.map((request) => toQuestionRequest(request));
  const childApprovals = current.pendingApprovals.filter((request) => request.source !== undefined);
  const childQuestions = current.pendingQuestions.filter((request) => request.source !== undefined);

  return {
    ...current,
    sessionAssociation,
    title: snapshot.title,
    ...activity,
    runtimeStatusMessage: activity.status === "idle" ? null : current.runtimeStatusMessage,
    liveParentExternalSessionId: snapshot.parentExternalSessionId,
    pendingApprovals: [...directApprovals, ...childApprovals],
    pendingQuestions: [...directQuestions, ...childQuestions],
    contextUsage: toContextUsage(snapshot.contextUsage),
  };
};

const createLiveOnlySession = (snapshot: AgentSessionLiveSnapshot): AgentSessionState => {
  const identity = toSessionIdentity(snapshot.ref);
  return applyDirectSnapshot(
    {
      ...identity,
      title: snapshot.title,
      sessionAssociation: snapshot.sessionAssociation,
      status: "idle",
      runtimeStatusMessage: null,
      startedAt: snapshot.startedAt,
      historyLoadState: "not_requested",
      messages: createSessionMessagesState(identity.externalSessionId),
      contextUsage: null,
      pendingApprovals: [],
      pendingQuestions: [],
      selectedModel: null,
    },
    snapshot,
  );
};

const sameSessionAssociation = (
  left: AgentSessionAssociation,
  right: AgentSessionAssociation,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind !== "workflow") {
    return true;
  }
  return right.kind === "workflow" && left.taskId === right.taskId && left.role === right.role;
};

const rebuildProjectedPendingInput = (
  collection: AgentSessionCollection,
): AgentSessionCollection => {
  let rebuilt = collection;
  for (const session of listAgentSessions(rebuilt)) {
    rebuilt = replaceAgentSession(rebuilt, {
      ...session,
      pendingApprovals: session.pendingApprovals.filter((request) => request.source === undefined),
      pendingQuestions: session.pendingQuestions.filter((request) => request.source === undefined),
    });
  }

  const mirroredApprovalKeys = new Set<string>();
  const mirroredQuestionKeys = new Set<string>();
  for (const owner of listAgentSessions(rebuilt)) {
    const ownerIdentity: AgentSessionRuntimeTarget = {
      externalSessionId: owner.externalSessionId,
      runtimeKind: owner.runtimeKind,
      workingDirectory: owner.workingDirectory,
      sessionAssociation: owner.sessionAssociation,
    };
    const ownerKey = agentSessionIdentityKey(ownerIdentity);
    const visited = new Set([ownerKey]);
    let descendant = owner;

    while (descendant.liveParentExternalSessionId) {
      const parent = getAgentSession(rebuilt, {
        externalSessionId: descendant.liveParentExternalSessionId,
        runtimeKind: descendant.runtimeKind,
        workingDirectory: descendant.workingDirectory,
      });
      if (!parent) {
        break;
      }
      const parentKey = agentSessionIdentityKey(parent);
      if (visited.has(parentKey)) {
        break;
      }
      visited.add(parentKey);
      const source: AgentPendingInputSource = {
        kind: "subagent",
        parentExternalSessionId: parent.externalSessionId,
        childExternalSessionId: owner.externalSessionId,
      };
      const pendingApprovals = [...parent.pendingApprovals];
      const pendingQuestions = [...parent.pendingQuestions];

      for (const approval of owner.pendingApprovals) {
        const key = `${parentKey}\u0000${ownerKey}\u0000${approval.requestId}`;
        if (mirroredApprovalKeys.has(key)) {
          continue;
        }
        mirroredApprovalKeys.add(key);
        pendingApprovals.push({ ...approval, source, responseSession: ownerIdentity });
      }
      for (const question of owner.pendingQuestions) {
        const key = `${parentKey}\u0000${ownerKey}\u0000${question.requestId}`;
        if (mirroredQuestionKeys.has(key)) {
          continue;
        }
        mirroredQuestionKeys.add(key);
        pendingQuestions.push({ ...question, source, responseSession: ownerIdentity });
      }
      descendant = { ...parent, pendingApprovals, pendingQuestions };
      rebuilt = replaceAgentSession(rebuilt, descendant);
    }
  }

  return rebuilt;
};

const settleRemovedDirectSession = (session: AgentSessionState): AgentSessionState => {
  const activity = settleAbsentSessionActivity(session);
  return {
    ...session,
    ...activity,
    runtimeStatusMessage: null,
    liveParentExternalSessionId: undefined,
    pendingApprovals: session.pendingApprovals.filter((request) => request.source !== undefined),
    pendingQuestions: session.pendingQuestions.filter((request) => request.source !== undefined),
    contextUsage: null,
  };
};

const persistedRecordKeys = (taskSessionRecords: TaskSessionRecords): Set<string> =>
  new Set(
    taskSessionRecords.records.map(({ record }) =>
      agentSessionIdentityKey(toPersistedSessionIdentity(record)),
    ),
  );

const resetSessionLiveStateForSnapshot = (
  session: AgentSessionState,
  hasLiveSnapshot: boolean,
): AgentSessionState => ({
  ...session,
  ...(hasLiveSnapshot
    ? projectObservedSessionActivity(session, "idle")
    : settleAbsentSessionActivity(session)),
  runtimeStatusMessage: null,
  liveParentExternalSessionId: undefined,
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

const materializePersistedSessions = ({
  current,
  taskSessionRecords,
  liveSnapshotKeys,
}: {
  current: AgentSessionCollection;
  taskSessionRecords: TaskSessionRecords;
  liveSnapshotKeys: ReadonlySet<string>;
}): AgentSessionCollection => {
  const loadedTaskIds = new Set(taskSessionRecords.taskIds);
  const persistedKeys = persistedRecordKeys(taskSessionRecords);
  const carried: AgentSessionState[] = [];
  for (const session of listAgentSessions(current)) {
    const workflowAssociation = isWorkflowAgentSession(session) ? session.sessionAssociation : null;
    const shouldCarrySession =
      (workflowAssociation === null && liveSnapshotKeys.has(agentSessionIdentityKey(session))) ||
      (workflowAssociation !== null &&
        (!loadedTaskIds.has(workflowAssociation.taskId) ||
          session.status === "starting" ||
          persistedKeys.has(agentSessionIdentityKey(session))));
    if (shouldCarrySession) {
      carried.push(
        resetSessionLiveStateForSnapshot(
          session,
          liveSnapshotKeys.has(agentSessionIdentityKey(session)),
        ),
      );
    }
  }
  let collection = createAgentSessionCollection(carried);
  for (const { taskId, record } of taskSessionRecords.records) {
    const identity = toPersistedSessionIdentity(record);
    const currentSession = getAgentSession(current, identity);
    collection = replaceAgentSession(
      collection,
      toPersistedSessionView({
        taskId,
        record,
        ...(currentSession
          ? {
              current: resetSessionLiveStateForSnapshot(
                currentSession,
                liveSnapshotKeys.has(agentSessionIdentityKey(currentSession)),
              ),
            }
          : undefined),
      }),
    );
  }
  return collection;
};

export const buildAgentSessionLiveCollection = ({
  current,
  taskSessionRecords,
  snapshots,
}: {
  current: AgentSessionCollection;
  taskSessionRecords: TaskSessionRecords;
  snapshots: readonly AgentSessionLiveSnapshot[];
}): AgentSessionCollection => {
  const liveSnapshotKeys = new Set(
    snapshots.map((snapshot) => agentSessionIdentityKey(toSessionIdentity(snapshot.ref))),
  );
  let collection = materializePersistedSessions({
    current,
    taskSessionRecords,
    liveSnapshotKeys,
  });

  for (const snapshot of snapshots) {
    const session = getAgentSession(collection, toSessionIdentity(snapshot.ref));
    if (session) {
      collection = replaceAgentSession(collection, applyDirectSnapshot(session, snapshot));
      continue;
    }
    collection = replaceAgentSession(collection, createLiveOnlySession(snapshot));
  }
  return rebuildProjectedPendingInput(collection);
};

export const applyTaskSessionRecords = ({
  current,
  taskSessionRecords,
}: {
  current: AgentSessionCollection;
  taskSessionRecords: TaskSessionRecords;
}): AgentSessionCollection => {
  const loadedTaskIds = new Set(taskSessionRecords.taskIds);
  const persistedKeys = persistedRecordKeys(taskSessionRecords);
  let collection = current;
  for (const session of listAgentSessions(current)) {
    const workflowAssociation = isWorkflowAgentSession(session) ? session.sessionAssociation : null;
    const recordDisappeared =
      workflowAssociation !== null &&
      loadedTaskIds.has(workflowAssociation.taskId) &&
      session.status !== "starting" &&
      !persistedKeys.has(agentSessionIdentityKey(session));
    if (recordDisappeared) {
      collection = removeAgentSession(collection, session);
    }
  }
  for (const { taskId, record } of taskSessionRecords.records) {
    const identity = toPersistedSessionIdentity(record);
    const currentSession = getAgentSession(collection, identity);
    collection = replaceAgentSession(
      collection,
      toPersistedSessionView({
        taskId,
        record,
        ...(currentSession ? { current: currentSession } : undefined),
      }),
    );
  }
  return rebuildProjectedPendingInput(collection);
};

export const applyAgentSessionLiveDelta = ({
  current,
  taskSessionRecords,
  envelope,
}: {
  current: AgentSessionCollection;
  taskSessionRecords: TaskSessionRecords;
  envelope: LiveProjectionEnvelope;
}): AgentSessionCollection => {
  if (envelope.type === "session_upsert") {
    const identity = toSessionIdentity(envelope.session.ref);
    const session = getAgentSession(current, identity);
    const withDirectSnapshot = replaceAgentSession(
      current,
      session
        ? applyDirectSnapshot(session, envelope.session)
        : createLiveOnlySession(envelope.session),
    );
    return rebuildProjectedPendingInput(withDirectSnapshot);
  }

  const identity = toSessionIdentity(envelope.ref);
  let collection = current;
  const directSession = getAgentSession(collection, identity);
  if (directSession) {
    collection = replaceAgentSession(collection, settleRemovedDirectSession(directSession));
  } else if (!persistedRecordKeys(taskSessionRecords).has(agentSessionIdentityKey(identity))) {
    collection = removeAgentSession(collection, identity);
  }
  return rebuildProjectedPendingInput(collection);
};

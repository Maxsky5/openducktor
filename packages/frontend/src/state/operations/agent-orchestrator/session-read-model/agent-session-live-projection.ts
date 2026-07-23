import type {
  AgentSessionLiveEnvelope,
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { agentSessionStatusFromActivity } from "@openducktor/core";
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
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { toPersistedSessionIdentity, toPersistedSessionView } from "../support/persistence";
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

type PendingInputRouting = {
  source: AgentPendingInputSource;
  responseSession: AgentSessionIdentity;
};

const toApprovalRequest = (
  request: AgentSessionLivePendingApprovalRequest,
  routing?: PendingInputRouting,
): AgentApprovalRequest => ({
  requestId: request.requestId,
  requestType: request.requestType,
  title: request.title,
  ...(request.summary !== undefined ? { summary: request.summary } : {}),
  ...(request.details !== undefined ? { details: request.details } : {}),
  ...(request.affectedPaths !== undefined ? { affectedPaths: request.affectedPaths } : {}),
  ...(request.command !== undefined
    ? {
        command: {
          command: request.command.command,
          ...(request.command.workingDirectory !== undefined
            ? { workingDirectory: request.command.workingDirectory }
            : {}),
        },
      }
    : {}),
  ...(request.action !== undefined
    ? {
        action: {
          name: request.action.name,
          ...(request.action.description !== undefined
            ? { description: request.action.description }
            : {}),
        },
      }
    : {}),
  ...(request.tool !== undefined
    ? {
        tool: {
          name: request.tool.name,
          ...(request.tool.title !== undefined ? { title: request.tool.title } : {}),
          ...(request.tool.input !== undefined ? { input: request.tool.input } : {}),
        },
      }
    : {}),
  ...(request.mutation !== undefined ? { mutation: request.mutation } : {}),
  ...(request.supportedReplyOutcomes !== undefined
    ? { supportedReplyOutcomes: request.supportedReplyOutcomes }
    : {}),
  ...(routing ?? {}),
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
    ...(question.multiple !== undefined ? { multiple: question.multiple } : {}),
    ...(question.custom !== undefined ? { custom: question.custom } : {}),
  })),
  ...(routing ?? {}),
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
          : {}),
        ...(contextUsage.outputLimit !== undefined
          ? { outputLimit: contextUsage.outputLimit }
          : {}),
        ...(contextUsage.providerId !== undefined ? { providerId: contextUsage.providerId } : {}),
        ...(contextUsage.modelId !== undefined ? { modelId: contextUsage.modelId } : {}),
        ...(contextUsage.variant !== undefined ? { variant: contextUsage.variant } : {}),
        ...(contextUsage.profileId !== undefined ? { profileId: contextUsage.profileId } : {}),
      };

const applyDirectSnapshot = (
  current: AgentSessionState,
  snapshot: AgentSessionLiveSnapshot,
  statusMode: "hydrate" | "preserve",
): AgentSessionState => {
  if (isTerminalSessionStatus(current.status)) {
    return {
      ...current,
      liveParentExternalSessionId: snapshot.parentExternalSessionId,
      pendingApprovals: [],
      pendingQuestions: [],
      pendingUserMessageStartedAt: undefined,
      runtimeStatusMessage: null,
    };
  }
  const snapshotStatus = agentSessionStatusFromActivity(snapshot.activity);
  const hydratedStatus =
    current.status === "starting" && snapshotStatus === "idle" ? "starting" : snapshotStatus;
  const nextStatus = statusMode === "hydrate" ? hydratedStatus : current.status;
  const directApprovals = snapshot.pendingApprovals.map((request) => toApprovalRequest(request));
  const directQuestions = snapshot.pendingQuestions.map((request) => toQuestionRequest(request));
  const childApprovals = current.pendingApprovals.filter((request) => request.source !== undefined);
  const childQuestions = current.pendingQuestions.filter((request) => request.source !== undefined);

  return {
    ...current,
    title: snapshot.title,
    status: nextStatus,
    runtimeStatusMessage: nextStatus === "idle" ? null : current.runtimeStatusMessage,
    liveParentExternalSessionId: snapshot.parentExternalSessionId,
    pendingApprovals: [...directApprovals, ...childApprovals],
    pendingQuestions: [...directQuestions, ...childQuestions],
    contextUsage: toContextUsage(snapshot.contextUsage),
    ...(nextStatus === "idle" ? { pendingUserMessageStartedAt: undefined } : {}),
  };
};

const createLiveOnlySession = (
  snapshot: AgentSessionLiveSnapshot,
  parent: AgentSessionState | null,
): AgentSessionState => {
  const identity = toSessionIdentity(snapshot.ref);
  return applyDirectSnapshot(
    {
      ...identity,
      title: snapshot.title,
      taskId: parent?.taskId ?? "",
      role: null,
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
    "hydrate",
  );
};

const findParentSession = (
  collection: AgentSessionCollection,
  ref: AgentSessionLiveRef,
  parentExternalSessionId: string,
): AgentSessionState | null =>
  getAgentSession(collection, {
    externalSessionId: parentExternalSessionId,
    runtimeKind: ref.runtimeKind,
    workingDirectory: ref.workingDirectory,
  });

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
    const ownerIdentity: AgentSessionIdentity = {
      externalSessionId: owner.externalSessionId,
      runtimeKind: owner.runtimeKind,
      workingDirectory: owner.workingDirectory,
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

const settleRemovedDirectSession = (session: AgentSessionState): AgentSessionState => ({
  ...session,
  status:
    session.status === "starting" || isTerminalSessionStatus(session.status)
      ? session.status
      : "idle",
  runtimeStatusMessage: null,
  liveParentExternalSessionId: undefined,
  pendingApprovals: session.pendingApprovals.filter((request) => request.source !== undefined),
  pendingQuestions: session.pendingQuestions.filter((request) => request.source !== undefined),
  contextUsage: null,
  pendingUserMessageStartedAt: undefined,
});

const persistedRecordKeys = (taskSessionRecords: TaskSessionRecords): Set<string> =>
  new Set(
    taskSessionRecords.records.map(({ record }) =>
      agentSessionIdentityKey(toPersistedSessionIdentity(record)),
    ),
  );

const resetSessionLiveStateForSnapshot = (session: AgentSessionState): AgentSessionState => ({
  ...session,
  status:
    session.status === "starting" || isTerminalSessionStatus(session.status)
      ? session.status
      : "idle",
  runtimeStatusMessage: null,
  liveParentExternalSessionId: undefined,
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  pendingUserMessageStartedAt: undefined,
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
    const shouldCarrySession =
      (session.role === null && liveSnapshotKeys.has(agentSessionIdentityKey(session))) ||
      (session.role !== null &&
        (!loadedTaskIds.has(session.taskId) ||
          session.status === "starting" ||
          persistedKeys.has(agentSessionIdentityKey(session))));
    if (shouldCarrySession) {
      carried.push(resetSessionLiveStateForSnapshot(session));
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
        ...(currentSession ? { current: resetSessionLiveStateForSnapshot(currentSession) } : {}),
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
      collection = replaceAgentSession(
        collection,
        applyDirectSnapshot(session, snapshot, "hydrate"),
      );
      continue;
    }
    const parent = snapshot.parentExternalSessionId
      ? findParentSession(collection, snapshot.ref, snapshot.parentExternalSessionId)
      : null;
    collection = replaceAgentSession(collection, createLiveOnlySession(snapshot, parent));
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
    const recordDisappeared =
      session.role !== null &&
      loadedTaskIds.has(session.taskId) &&
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
        ...(currentSession ? { current: currentSession } : {}),
      }),
    );
  }
  return collection;
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
    const parent = envelope.session.parentExternalSessionId
      ? findParentSession(current, envelope.session.ref, envelope.session.parentExternalSessionId)
      : null;
    const withDirectSnapshot = replaceAgentSession(
      current,
      session
        ? applyDirectSnapshot(session, envelope.session, "preserve")
        : createLiveOnlySession(envelope.session, parent),
    );
    return rebuildProjectedPendingInput(withDirectSnapshot);
  }

  const identity = toSessionIdentity(envelope.ref);
  let collection = current;
  const directSession = getAgentSession(collection, identity);
  if (directSession?.role === null) {
    collection = removeAgentSession(collection, identity);
  } else if (directSession) {
    collection = replaceAgentSession(collection, settleRemovedDirectSession(directSession));
  } else if (!persistedRecordKeys(taskSessionRecords).has(agentSessionIdentityKey(identity))) {
    collection = removeAgentSession(collection, identity);
  }
  return rebuildProjectedPendingInput(collection);
};

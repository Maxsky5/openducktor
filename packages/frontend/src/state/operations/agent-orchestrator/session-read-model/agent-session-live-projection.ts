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

type LiveProjectionEnvelope = Extract<
  AgentSessionLiveEnvelope,
  { type: "session_upsert" | "session_removed" }
>;

const toSessionIdentity = (ref: AgentSessionLiveRef): AgentSessionIdentity => ({
  externalSessionId: ref.externalSessionId,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
});

const agentSessionLiveSnapshotIdentityKeys = (
  snapshots: readonly AgentSessionLiveSnapshot[],
): ReadonlySet<string> =>
  new Set(snapshots.map((snapshot) => agentSessionIdentityKey(toSessionIdentity(snapshot.ref))));

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
): AgentApprovalRequest => {
  const approval: AgentApprovalRequest = {
    requestId: request.requestId,
    requestType: request.requestType,
    title: request.title,
  };
  if (request.summary !== undefined) {
    approval.summary = request.summary;
  }
  if (request.details !== undefined) {
    approval.details = request.details;
  }
  if (request.affectedPaths !== undefined) {
    approval.affectedPaths = request.affectedPaths;
  }
  if (request.command !== undefined) {
    const command: NonNullable<AgentApprovalRequest["command"]> = {
      command: request.command.command,
    };
    if (request.command.workingDirectory !== undefined) {
      command.workingDirectory = request.command.workingDirectory;
    }
    approval.command = command;
  }
  if (request.action !== undefined) {
    const action: NonNullable<AgentApprovalRequest["action"]> = { name: request.action.name };
    if (request.action.description !== undefined) {
      action.description = request.action.description;
    }
    approval.action = action;
  }
  if (request.tool !== undefined) {
    const tool: NonNullable<AgentApprovalRequest["tool"]> = { name: request.tool.name };
    if (request.tool.title !== undefined) {
      tool.title = request.tool.title;
    }
    if (request.tool.input !== undefined) {
      tool.input = request.tool.input;
    }
    approval.tool = tool;
  }
  if (request.mutation !== undefined) {
    approval.mutation = request.mutation;
  }
  if (request.supportedReplyOutcomes !== undefined) {
    approval.supportedReplyOutcomes = request.supportedReplyOutcomes;
  }
  if (routing) {
    approval.source = routing.source;
    approval.responseSession = routing.responseSession;
  }
  return approval;
};

const toQuestionRequest = (
  request: AgentSessionLivePendingQuestionRequest,
  routing?: PendingInputRouting,
): AgentQuestionRequest => {
  const questions: AgentQuestionRequest["questions"] = request.questions.map((question) => {
    const projectedQuestion: AgentQuestionRequest["questions"][number] = {
      header: question.header,
      question: question.question,
      options: question.options,
    };
    if (question.multiple !== undefined) {
      projectedQuestion.multiple = question.multiple;
    }
    if (question.custom !== undefined) {
      projectedQuestion.custom = question.custom;
    }
    return projectedQuestion;
  });
  const questionRequest: AgentQuestionRequest = { requestId: request.requestId, questions };
  if (routing) {
    questionRequest.source = routing.source;
    questionRequest.responseSession = routing.responseSession;
  }
  return questionRequest;
};

export const toContextUsage = (
  contextUsage: AgentSessionLiveSnapshot["contextUsage"],
): Exclude<AgentSessionState["contextUsage"], undefined> => {
  if (contextUsage === null) {
    return null;
  }
  const projected: NonNullable<AgentSessionState["contextUsage"]> = {
    totalTokens: contextUsage.totalTokens,
  };
  if (contextUsage.contextWindow !== undefined) {
    projected.contextWindow = contextUsage.contextWindow;
  }
  if (contextUsage.outputLimit !== undefined) {
    projected.outputLimit = contextUsage.outputLimit;
  }
  if (contextUsage.providerId !== undefined) {
    projected.providerId = contextUsage.providerId;
  }
  if (contextUsage.modelId !== undefined) {
    projected.modelId = contextUsage.modelId;
  }
  if (contextUsage.variant !== undefined) {
    projected.variant = contextUsage.variant;
  }
  if (contextUsage.profileId !== undefined) {
    projected.profileId = contextUsage.profileId;
  }
  return projected;
};

const sameContextUsage = (
  current: Exclude<AgentSessionState["contextUsage"], undefined>,
  incoming: AgentSessionLiveSnapshot["contextUsage"],
): boolean => {
  if (!current || !incoming) {
    return current === incoming;
  }
  return (
    current.totalTokens === incoming.totalTokens &&
    current.contextWindow === incoming.contextWindow &&
    current.outputLimit === incoming.outputLimit &&
    current.providerId === incoming.providerId &&
    current.modelId === incoming.modelId &&
    current.variant === incoming.variant &&
    current.profileId === incoming.profileId
  );
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
  const selectedModel = current.selectedModel ?? snapshot.model ?? null;
  const currentContextUsage = current.contextUsage ?? null;
  const contextUsage = sameContextUsage(currentContextUsage, snapshot.contextUsage)
    ? currentContextUsage
    : toContextUsage(snapshot.contextUsage);
  if (isTerminalSessionStatus(current.status)) {
    return {
      ...current,
      sessionAssociation,
      livePresence: "present",
      selectedModel,
      contextUsage: contextUsage ?? currentContextUsage,
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
    selectedModel,
    ...activity,
    runtimeStatusMessage: activity.status === "idle" ? null : current.runtimeStatusMessage,
    livePresence: "present",
    liveParentExternalSessionId: snapshot.parentExternalSessionId,
    pendingApprovals: [...directApprovals, ...childApprovals],
    pendingQuestions: [...directQuestions, ...childQuestions],
    contextUsage,
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
      livePresence: "present",
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

export const rebuildProjectedPendingInput = (
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
    livePresence: "absent",
    pendingApprovals: session.pendingApprovals.filter((request) => request.source !== undefined),
    pendingQuestions: session.pendingQuestions.filter((request) => request.source !== undefined),
    contextUsage: null,
  };
};

const resetSessionLiveStateForSnapshot = (
  session: AgentSessionState,
  hasLiveSnapshot: boolean,
): AgentSessionState => ({
  ...session,
  ...(hasLiveSnapshot
    ? projectObservedSessionActivity(session, "idle")
    : settleAbsentSessionActivity(session)),
  runtimeStatusMessage: null,
  livePresence: hasLiveSnapshot ? "present" : "absent",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

/**
 * Sessions that survive an authoritative snapshot without live evidence.
 *
 * Workflow-associated projections stay until the workflow-record overlay proves
 * their durable record disappeared against a loaded task; starting sessions are
 * protected while their launch is still in flight.
 */
const isRetainedWithoutLiveSnapshot = (session: AgentSessionState): boolean =>
  session.status === "starting" || session.sessionAssociation.kind === "workflow";

export const buildAgentSessionLiveCollection = ({
  current,
  snapshots,
}: {
  current: AgentSessionCollection;
  snapshots: readonly AgentSessionLiveSnapshot[];
}): AgentSessionCollection => {
  const liveSnapshotKeys = agentSessionLiveSnapshotIdentityKeys(snapshots);
  let collection = current;
  for (const session of listAgentSessions(current)) {
    const hasLiveSnapshot = liveSnapshotKeys.has(agentSessionIdentityKey(session));
    if (!hasLiveSnapshot && !isRetainedWithoutLiveSnapshot(session)) {
      collection = removeAgentSession(collection, session);
      continue;
    }
    collection = replaceAgentSession(
      collection,
      resetSessionLiveStateForSnapshot(session, hasLiveSnapshot),
    );
  }

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

export const applyAgentSessionLiveDelta = ({
  current,
  envelope,
}: {
  current: AgentSessionCollection;
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

  let collection = current;
  const directSession = getAgentSession(collection, toSessionIdentity(envelope.ref));
  if (directSession) {
    collection = replaceAgentSession(collection, settleRemovedDirectSession(directSession));
  }
  return rebuildProjectedPendingInput(collection);
};

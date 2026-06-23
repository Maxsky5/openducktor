import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentSessionTodoItem,
  buildReadOnlyPermissionRejectionMessage,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  createSessionMessagesFixture,
  lastSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import { createSessionTurnMetadata } from "../support/session-turn-metadata";
import {
  createAgentSessionCollectionRefFixture,
  findAgentSessionFixture,
  getAgentSessionFixture,
  replaceAgentSessionFixture,
} from "../test-utils";
import { createSessionEventBatcher } from "./session-event-batching";
import type {
  ObserveAgentSessionParams,
  SessionEvent,
  SessionPartEventContext,
} from "./session-event-types";
import {
  listenToAgentSessionEvents as listenToAgentSessionEventsImpl,
  type SessionEventAdapter,
} from "./session-events";
import { handleAssistantPart } from "./session-parts";

export const createRecordingSessionTodosUpdater = () => {
  let todos: AgentSessionTodoItem[] = [];
  return {
    updateSessionTodos: (
      _session: Parameters<ObserveAgentSessionParams["updateSessionTodos"]>[0],
      updater: Parameters<ObserveAgentSessionParams["updateSessionTodos"]>[1],
    ) => {
      todos = updater(todos);
    },
    getTodos: () => todos,
  };
};

type BuildSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

export const buildSession = (overrides: BuildSessionOverrides = {}): AgentSessionState => {
  const { messages, ...sessionOverrides } = overrides;
  const externalSessionId = sessionOverrides.externalSessionId ?? "session-1";

  return {
    runtimeKind: "opencode",
    externalSessionId,
    taskId: "task-1",
    role: "spec",
    status: "running",
    startedAt: "2026-02-22T08:00:00.000Z",
    workingDirectory: "/tmp/repo",
    messages: createSessionMessagesFixture(externalSessionId, messages),
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...sessionOverrides,
    historyLoadState: sessionOverrides.historyLoadState ?? "not_requested",
  };
};

export const getSession = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
): AgentSessionState => getAgentSessionFixture(sessionsRef, externalSessionId);

export const findSession = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
): AgentSessionState | undefined => findAgentSessionFixture(sessionsRef, externalSessionId);

export const replaceSessionForTest = (
  collection: AgentSessionCollection,
  session: AgentSessionState,
): AgentSessionCollection => replaceAgentSessionFixture(collection, session);

export const createSessionsRef = createAgentSessionCollectionRefFixture;

export const createSessionUpdater = (sessionsRef: { current: AgentSessionCollection }) => {
  return (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
  ): AgentSessionState | null => {
    const current = getAgentSession(sessionsRef.current, identity);
    if (!current) {
      return null;
    }
    const nextSession = updater(current);
    sessionsRef.current = replaceAgentSessionByIdentity(sessionsRef.current, identity, nextSession);
    return nextSession;
  };
};

export const getSessionMessages = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
) => sessionMessagesToArray(getSession(sessionsRef, externalSessionId));

export const getSessionMessagesByIdentity = (
  sessionsRef: { current: AgentSessionCollection },
  identity: AgentSessionIdentity,
) => {
  const session = getAgentSession(sessionsRef.current, identity);
  if (!session) {
    return [];
  }
  return sessionMessagesToArray(session);
};

type ObserveAgentSessionEventsTestParams = Omit<
  ObserveAgentSessionParams,
  | "sessionRef"
  | "turnMetadata"
  | "readSession"
  | "ensureSession"
  | "updateSessionTodos"
  | "recordTurnActivityTimestamp"
  | "recordTurnUserMessageTimestamp"
  | "buildReadOnlyApprovalRejectionMessage"
  | "readOnlyApprovalAutoRejectSafe"
  | "workflowToolAliasesByCanonical"
  | "isSessionObserved"
> &
  Partial<
    Pick<
      ObserveAgentSessionParams,
      | "sessionRef"
      | "turnMetadata"
      | "ensureSession"
      | "updateSessionTodos"
      | "recordTurnActivityTimestamp"
      | "recordTurnUserMessageTimestamp"
      | "buildReadOnlyApprovalRejectionMessage"
      | "readOnlyApprovalAutoRejectSafe"
      | "workflowToolAliasesByCanonical"
      | "isSessionObserved"
    >
  > & {
    sessionsRef: { current: AgentSessionCollection };
    externalSessionId?: string;
    repoPath?: string;
  };

export const listenToAgentSessionEvents = (
  params: ObserveAgentSessionEventsTestParams,
): Promise<() => void> => {
  const {
    externalSessionId,
    repoPath,
    sessionsRef,
    sessionRef: providedSessionRef,
    turnMetadata,
    ensureSession,
    updateSessionTodos,
    recordTurnActivityTimestamp,
    recordTurnUserMessageTimestamp,
    buildReadOnlyApprovalRejectionMessage,
    readOnlyApprovalAutoRejectSafe,
    workflowToolAliasesByCanonical,
    isSessionObserved,
    ...eventParams
  } = params;
  const targetExternalSessionId =
    providedSessionRef?.externalSessionId ?? externalSessionId ?? "session-1";
  sessionsRef.current = createAgentSessionCollection(listAgentSessions(sessionsRef.current));
  const session = getSession(sessionsRef, targetExternalSessionId);
  const sessionRef = providedSessionRef ?? {
    externalSessionId: targetExternalSessionId,
    repoPath: repoPath ?? "/tmp/repo",
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
  };

  return listenToAgentSessionEventsImpl({
    ...eventParams,
    turnMetadata: turnMetadata ?? createSessionTurnMetadata(),
    recordTurnActivityTimestamp: recordTurnActivityTimestamp ?? (() => {}),
    recordTurnUserMessageTimestamp: recordTurnUserMessageTimestamp ?? (() => {}),
    buildReadOnlyApprovalRejectionMessage:
      buildReadOnlyApprovalRejectionMessage ??
      ((role) =>
        Promise.resolve(
          buildReadOnlyPermissionRejectionMessage({
            role,
            overrides: {},
          }),
        )),
    readOnlyApprovalAutoRejectSafe:
      readOnlyApprovalAutoRejectSafe ??
      OPENCODE_RUNTIME_DESCRIPTOR.capabilities.approvals.readOnlyAutoRejectSafe,
    workflowToolAliasesByCanonical:
      workflowToolAliasesByCanonical ?? OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
    isSessionObserved:
      isSessionObserved ??
      ((candidateSession) =>
        agentSessionIdentityKey(candidateSession) === agentSessionIdentityKey(sessionRef)),
    ensureSession:
      ensureSession ??
      ((identity, createSession) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (current) {
          return current;
        }
        const nextSession = createSession();
        sessionsRef.current = replaceAgentSession(sessionsRef.current, nextSession);
        return nextSession;
      }),
    updateSessionTodos: updateSessionTodos ?? (() => {}),
    readSession: (identity) => getAgentSession(sessionsRef.current, identity),
    sessionRef,
  });
};

export const getLastSessionMessage = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
) => lastSessionMessageForTest(getSession(sessionsRef, externalSessionId));

export type { AgentSessionState, SessionEvent, SessionEventAdapter, SessionPartEventContext };
export type SessionUpdateFn = ObserveAgentSessionParams["updateSession"];
export {
  createSessionEventBatcher,
  createSessionTurnMetadata,
  handleAssistantPart,
  OPENCODE_RUNTIME_DESCRIPTOR,
  sessionMessageAt,
  withMockedToast,
};

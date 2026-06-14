import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentSessionTodoItem,
  buildReadOnlyPermissionRejectionMessage,
} from "@openducktor/core";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
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
import {
  createAgentSessionCollectionRefFixture,
  findAgentSessionFixture,
  getAgentSessionFixture,
  replaceAgentSessionFixture,
} from "../test-utils";
import { createSessionEventBatcher } from "./session-event-batching";
import type {
  ListenToAgentSessionParams,
  SessionEvent,
  SessionPartEventContext,
} from "./session-event-types";
import {
  listenToAgentSessionEvents as listenToAgentSessionEventsImpl,
  type SessionEventAdapter,
} from "./session-events";
import { handleAssistantPart } from "./session-parts";

export const createRecordingRuntimeDataWriter = () => {
  let todos: AgentSessionTodoItem[] = [];
  let sessionRefs: Parameters<ListenToAgentSessionParams["runtimeDataWriter"]["updateTodos"]>[0][] =
    [];
  return {
    writer: {
      updateTodos: (
        session: Parameters<ListenToAgentSessionParams["runtimeDataWriter"]["updateTodos"]>[0],
        updater: (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[],
      ) => {
        sessionRefs = [...sessionRefs, session];
        todos = updater(todos);
      },
    },
    getTodos: () => todos,
    getSessionRefs: () => sessionRefs,
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
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
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
  ): void => {
    const current = getAgentSession(sessionsRef.current, identity);
    if (!current) {
      return;
    }
    sessionsRef.current = replaceAgentSessionByIdentity(
      sessionsRef.current,
      identity,
      updater(current),
    );
  };
};

export const getSessionMessages = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
) => sessionMessagesToArray(getSession(sessionsRef, externalSessionId));

type ListenToAgentSessionEventsTestParams = Omit<
  ListenToAgentSessionParams,
  | "sessionRef"
  | "runtimeDataWriter"
  | "recordTurnActivityTimestamp"
  | "recordTurnUserMessageTimestamp"
  | "buildReadOnlyApprovalRejectionMessage"
> &
  Partial<
    Pick<
      ListenToAgentSessionParams,
      | "sessionRef"
      | "runtimeDataWriter"
      | "recordTurnActivityTimestamp"
      | "recordTurnUserMessageTimestamp"
      | "buildReadOnlyApprovalRejectionMessage"
    >
  > & {
    externalSessionId?: string;
    repoPath?: string;
  };

export const listenToAgentSessionEvents = (
  params: ListenToAgentSessionEventsTestParams,
): Promise<() => void> => {
  const {
    externalSessionId,
    repoPath,
    sessionRef: providedSessionRef,
    runtimeDataWriter,
    recordTurnActivityTimestamp,
    recordTurnUserMessageTimestamp,
    buildReadOnlyApprovalRejectionMessage,
    ...eventParams
  } = params;
  const targetExternalSessionId =
    providedSessionRef?.externalSessionId ?? externalSessionId ?? "session-1";
  params.sessionsRef.current = createAgentSessionCollection(
    listAgentSessions(params.sessionsRef.current),
  );
  const session = getSession(params.sessionsRef, targetExternalSessionId);
  const sessionRef = providedSessionRef ?? {
    externalSessionId: targetExternalSessionId,
    repoPath: repoPath ?? "/tmp/repo",
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
  };

  return listenToAgentSessionEventsImpl({
    ...eventParams,
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
    runtimeDataWriter: runtimeDataWriter ?? {
      updateTodos: () => {},
    },
    sessionRef,
  });
};

export const getLastSessionMessage = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
) => lastSessionMessageForTest(getSession(sessionsRef, externalSessionId));

export type { AgentSessionState, SessionEvent, SessionEventAdapter, SessionPartEventContext };
export type SessionUpdateFn = ListenToAgentSessionParams["updateSession"];
export {
  createSessionEventBatcher,
  handleAssistantPart,
  OPENCODE_RUNTIME_DESCRIPTOR,
  sessionMessageAt,
  withMockedToast,
};

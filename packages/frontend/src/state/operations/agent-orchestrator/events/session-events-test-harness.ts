import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentSessionTodoItem,
  buildReadOnlyPermissionRejectionMessage,
} from "@openducktor/core";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  lastSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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

export const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
  historyLoadState: overrides.historyLoadState ?? "not_requested",
});

export const getSession = (
  sessionsRef: { current: Record<string, AgentSessionState> },
  externalSessionId = "session-1",
): AgentSessionState => {
  const session = sessionsRef.current[externalSessionId];
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

export const getSessionMessages = (
  sessionsRef: { current: Record<string, AgentSessionState> },
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
  sessionsRef: { current: Record<string, AgentSessionState> },
  externalSessionId = "session-1",
) => lastSessionMessageForTest(getSession(sessionsRef, externalSessionId));

export type { AgentSessionState, SessionEvent, SessionEventAdapter, SessionPartEventContext };
export {
  createSessionEventBatcher,
  handleAssistantPart,
  OPENCODE_RUNTIME_DESCRIPTOR,
  sessionMessageAt,
  withMockedToast,
};

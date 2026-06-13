import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentSessionTodoItem } from "@openducktor/core";
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
  return {
    writer: {
      updateTodos: (
        _repoPath: string,
        _session: Parameters<ListenToAgentSessionParams["runtimeDataWriter"]["updateTodos"]>[1],
        updater: (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[],
      ) => {
        todos = updater(todos);
      },
    },
    getTodos: () => todos,
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

export const listenToAgentSessionEvents = (
  params: Omit<ListenToAgentSessionParams, "sessionRef" | "runtimeDataWriter"> &
    Partial<Pick<ListenToAgentSessionParams, "sessionRef" | "runtimeDataWriter">>,
): Promise<() => void> => {
  const session = getSession(params.sessionsRef, params.externalSessionId);
  return listenToAgentSessionEventsImpl({
    ...params,
    runtimeDataWriter: params.runtimeDataWriter ?? {
      updateTodos: () => {},
    },
    sessionRef: params.sessionRef ?? {
      externalSessionId: params.externalSessionId,
      repoPath: params.repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
    },
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

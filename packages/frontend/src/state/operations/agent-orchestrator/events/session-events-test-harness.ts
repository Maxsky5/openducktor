import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
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

export const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
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
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
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
  params: Omit<ListenToAgentSessionParams, "sessionRef"> &
    Partial<Pick<ListenToAgentSessionParams, "sessionRef">>,
): (() => void) => {
  const session = getSession(params.sessionsRef, params.externalSessionId);
  return listenToAgentSessionEventsImpl({
    ...params,
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

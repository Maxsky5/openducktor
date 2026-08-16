import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  resolveCodexEffectivePolicy,
} from "@openducktor/contracts";
import {
  type AgentSessionTodoItem,
  buildReadOnlyPermissionRejectionMessage,
  type PolicyBoundSessionRef,
  workflowAgentSessionScope,
} from "@openducktor/core";
import { toast } from "sonner";
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
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionTurnMetadata } from "../support/session-turn-metadata";
import {
  createAgentSessionCollectionRefFixture,
  findAgentSessionFixture,
  getAgentSessionFixture,
  replaceAgentSessionFixture,
} from "../test-utils";
import {
  createSessionEventBatcher,
  isImmediateSessionEvent,
  shouldFlushQueuedSessionEventImmediately,
} from "./session-event-batching";
import { createSessionEventRouter } from "./session-event-router.test-harness";
import type { ObserveAgentSessionParams, SessionEventAdapter } from "./session-event-test-types";
import type {
  SessionEvent,
  SessionEventContext,
  SessionPartEventContext,
} from "./session-event-types";
import {
  handleAssistantMessage,
  handleSessionCompacted,
  handleSessionCompactionStarted,
  handleSessionError,
  handleSessionFinished,
  handleSessionIdle,
  handleSessionStarted,
  handleSessionStatus,
  handleSessionTodosUpdated,
  handleTranscriptRetracted,
  handleTurnError,
  handleUserMessage,
} from "./session-lifecycle";
import { handleAssistantDelta, handleAssistantPart } from "./session-parts";

const SESSION_EVENT_BATCH_WINDOW_MS = 0;

const handleMcpReconnectStarted = (
  event: Extract<SessionEvent, { type: "mcp_reconnect_started" }>,
): void => {
  const details = event.errorDetails ? ` ${event.errorDetails}.` : "";
  toast.info("Reconnecting OpenDucktor MCP", {
    description: `OpenDucktor MCP is ${event.status} for ${event.workingDirectory}.${details} OpenDucktor is trying to reconnect.`,
  });
};

const handleSessionEvent = (context: SessionEventContext, event: SessionEvent): void => {
  switch (event.type) {
    case "session_started":
      handleSessionStarted(context, event);
      return;
    case "assistant_delta":
      handleAssistantDelta(context, event);
      return;
    case "assistant_part":
      handleAssistantPart(context, event);
      return;
    case "assistant_message":
      handleAssistantMessage(context, event);
      return;
    case "transcript_retracted":
      handleTranscriptRetracted(context, event);
      return;
    case "user_message":
      handleUserMessage(context, event);
      return;
    case "session_status":
      handleSessionStatus(context, event);
      return;
    case "mcp_reconnect_started":
      handleMcpReconnectStarted(event);
      return;
    case "session_todos_updated":
      handleSessionTodosUpdated(context, event);
      return;
    case "session_compaction_started":
      handleSessionCompactionStarted(context, event);
      return;
    case "session_compacted":
      handleSessionCompacted(context, event);
      return;
    case "turn_error":
      handleTurnError(context, event);
      return;
    case "session_error":
      handleSessionError(context, event);
      return;
    case "session_idle":
      handleSessionIdle(context, event);
      return;
    case "session_finished":
      handleSessionFinished(context, event);
      return;
  }
};

const listenToAgentSessionEventsImpl = async (
  context: ObserveAgentSessionParams,
): Promise<() => void> => {
  const batchWindowMs = context.eventBatchWindowMs ?? SESSION_EVENT_BATCH_WINDOW_MS;
  const router = createSessionEventRouter({
    createBatcher: createSessionEventBatcher,
    context,
    handleEvent: handleSessionEvent,
  });
  let batchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancelQueuedFlush = (): void => {
    if (batchTimeoutId !== null) {
      clearTimeout(batchTimeoutId);
      batchTimeoutId = null;
    }
  };
  const flushQueuedEvents = (): void => {
    cancelQueuedFlush();
    if (!router.hasQueuedEvents()) {
      return;
    }
    const nextDelayMs = router.flushReady();
    if (router.hasQueuedEvents()) {
      scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
    }
  };
  const scheduleQueuedFlush = (delayMs = batchWindowMs): void => {
    if (delayMs <= 0) {
      flushQueuedEvents();
      return;
    }
    if (batchTimeoutId !== null) {
      return;
    }
    batchTimeoutId = setTimeout(() => {
      batchTimeoutId = null;
      flushQueuedEvents();
    }, delayMs);
  };

  const unsubscribe = await context.adapter.subscribeEvents(context.sessionRef, (event) => {
    if (isImmediateSessionEvent(event)) {
      router.handleImmediate(event);
      return;
    }
    if (router.enqueue(event)) {
      if (shouldFlushQueuedSessionEventImmediately(event)) {
        flushQueuedEvents();
        return;
      }
      scheduleQueuedFlush();
    }
  });
  return () => {
    cancelQueuedFlush();
    try {
      router.flushAll();
    } finally {
      unsubscribe();
    }
  };
};

export const createRecordingSessionTodosUpdater = () => {
  const todosBySessionKey = new Map<string, AgentSessionTodoItem[]>();
  return {
    updateSessionTodos: (
      session: Parameters<ObserveAgentSessionParams["updateSessionTodos"]>[0],
      updater: Parameters<ObserveAgentSessionParams["updateSessionTodos"]>[1],
    ) => {
      const sessionKey = agentSessionIdentityKey(session);
      const currentTodos = todosBySessionKey.get(sessionKey) ?? [];
      todosBySessionKey.set(sessionKey, updater(currentTodos));
    },
    getTodos: (session?: Parameters<ObserveAgentSessionParams["updateSessionTodos"]>[0]) => {
      if (session) {
        return todosBySessionKey.get(agentSessionIdentityKey(session)) ?? [];
      }
      if (todosBySessionKey.size === 1) {
        return [...todosBySessionKey.values()][0] ?? [];
      }
      return [];
    },
  };
};

type BuildSessionOverrides =
  import("@/test-utils/shared-test-fixtures").AgentSessionFixtureOverrides;

export const buildSession = (overrides: BuildSessionOverrides = {}): AgentSessionState => {
  return createAgentSessionFixture(
    {
      runtimeKind: "opencode",
      externalSessionId: "session-1",
      taskId: "task-1",
      role: "spec",
      status: "running",
      runtimeStatusMessage: null,
      startedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo",
      messages: createSessionMessagesFixture("session-1"),
      contextUsage: null,
      pendingApprovals: [],
      pendingQuestions: [],
      selectedModel: null,
      historyLoadState: "not_requested",
    },
    overrides,
  );
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

const runtimeRefForSession = ({
  session,
  externalSessionId,
  repoPath,
}: {
  session: AgentSessionState;
  externalSessionId: string;
  repoPath: string;
}): PolicyBoundSessionRef => {
  if (session.sessionAssociation.kind !== "workflow") {
    throw new Error(`Session '${session.externalSessionId}' is not a workflow session.`);
  }
  const sessionScope = workflowAgentSessionScope(
    session.sessionAssociation.taskId,
    session.sessionAssociation.role,
  );
  const baseRef = {
    externalSessionId,
    repoPath,
    workingDirectory: session.workingDirectory,
    sessionScope,
  };

  if (session.runtimeKind === "opencode") {
    return {
      ...baseRef,
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
    };
  }

  if (session.runtimeKind === "claude") {
    return {
      ...baseRef,
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
    };
  }

  if (session.runtimeKind === "codex") {
    return {
      ...baseRef,
      runtimeKind: "codex",
      runtimePolicy: {
        kind: "codex",
        policy: resolveCodexEffectivePolicy(
          createSettingsSnapshotFixture().agentRuntimes.codex,
          session.sessionAssociation.role,
        ),
      },
    };
  }

  throw new Error(`Unsupported runtime kind '${session.runtimeKind}' in session event test.`);
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
  | "isSessionObserved"
> &
  Partial<
    Pick<
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
    readSession,
    ensureSession,
    updateSessionTodos,
    recordTurnActivityTimestamp,
    recordTurnUserMessageTimestamp,
    buildReadOnlyApprovalRejectionMessage,
    readOnlyApprovalAutoRejectSafe,
    isSessionObserved,
    ...eventParams
  } = params;
  const targetExternalSessionId =
    providedSessionRef?.externalSessionId ?? externalSessionId ?? "session-1";
  sessionsRef.current = createAgentSessionCollection(listAgentSessions(sessionsRef.current));
  const session = getSession(sessionsRef, targetExternalSessionId);
  if (session.sessionAssociation.kind !== "workflow") {
    throw new Error(`Session '${session.externalSessionId}' is not a workflow session.`);
  }
  const sessionRef =
    providedSessionRef ??
    runtimeRefForSession({
      externalSessionId: targetExternalSessionId,
      repoPath: repoPath ?? "/tmp/repo",
      session,
    });
  const runtimeDefinition =
    session.runtimeKind === "claude" ? CLAUDE_RUNTIME_DESCRIPTOR : OPENCODE_RUNTIME_DESCRIPTOR;

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
      runtimeDefinition.capabilities.approvals.readOnlyAutoRejectSafe,
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
    readSession: readSession ?? ((identity) => getAgentSession(sessionsRef.current, identity)),
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

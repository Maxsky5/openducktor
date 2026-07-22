import { describe, expect, test } from "bun:test";
import type { AgentSessionTodoItem, PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import { getAgentSession } from "@/state/agent-session-collection";
import { createSessionEventRouter } from "./session-event-router.test-harness";
import {
  type AgentSessionState,
  buildSession,
  createSessionEventBatcher,
  createSessionsRef,
  createSessionTurnMetadata,
  createSessionUpdater,
  getSession,
  getSessionMessages,
  getSessionMessagesByIdentity,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

const routeRef = (
  overrides: Partial<Omit<PolicyBoundSessionRef, "runtimeKind" | "runtimePolicy">> = {},
): PolicyBoundSessionRef => ({
  externalSessionId: "session-1",
  repoPath: "/tmp/repo",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo",
  runtimePolicy: { kind: "opencode" },
  ...overrides,
});

const userMessageEvent = ({
  message,
  messageId,
  sessionRef,
}: {
  message: string;
  messageId: string;
  sessionRef?: SessionRef;
}): Extract<SessionEvent, { type: "user_message" }> => ({
  type: "user_message",
  externalSessionId: sessionRef?.externalSessionId ?? "session-1",
  messageId,
  timestamp: "2026-02-22T08:00:03.000Z",
  message,
  parts: [{ kind: "text", text: message }],
  state: "read",
  ...(sessionRef ? { sessionRef } : {}),
});

const assistantPartEvent = ({
  text,
  messageId = "assistant-1",
  partId = "text-1",
  sessionRef,
}: {
  text: string;
  messageId?: string;
  partId?: string;
  sessionRef?: SessionRef;
}): Extract<SessionEvent, { type: "assistant_part" }> => ({
  type: "assistant_part",
  externalSessionId: sessionRef?.externalSessionId ?? "session-1",
  timestamp: "2026-02-22T08:00:01.000Z",
  ...(sessionRef ? { sessionRef } : {}),
  part: {
    kind: "text",
    messageId,
    partId,
    text,
    completed: false,
  },
});

const assistantMessageEvent = ({
  message,
  messageId = "assistant-1",
  sessionRef,
}: {
  message: string;
  messageId?: string;
  sessionRef?: SessionRef;
}): Extract<SessionEvent, { type: "assistant_message" }> => ({
  type: "assistant_message",
  externalSessionId: sessionRef?.externalSessionId ?? "session-1",
  messageId,
  timestamp: "2026-02-22T08:00:03.000Z",
  message,
  ...(sessionRef ? { sessionRef } : {}),
});

const createRoutingHarness = async ({
  eventBatchWindowMs,
  repoPath = "/tmp/repo",
  sessionRef,
  sessions,
  updateSessionTodos,
}: {
  eventBatchWindowMs?: number;
  repoPath?: string;
  sessionRef?: PolicyBoundSessionRef;
  sessions?: AgentSessionState[];
  updateSessionTodos?: (
    session: SessionRef,
    updater: (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[],
  ) => void;
} = {}) => {
  const handlers: Array<(event: SessionEvent) => void> = [];
  const adapter: SessionEventAdapter = {
    subscribeEvents: async (_externalSessionId, handler) => {
      handlers.push(handler);
      return () => {};
    },
    replyApproval: async () => {},
  };
  const sessionTwoRef: SessionRef = {
    externalSessionId: "session-2",
    repoPath,
    runtimeKind: "opencode",
    workingDirectory: `${repoPath}/worktrees/session-2`,
  };
  const sessionsRef = createSessionsRef(
    sessions ?? [
      buildSession({ externalSessionId: "session-1", workingDirectory: repoPath }),
      buildSession({
        externalSessionId: sessionTwoRef.externalSessionId,
        workingDirectory: sessionTwoRef.workingDirectory,
      }),
    ],
  );
  const updateSession = createSessionUpdater(sessionsRef);

  const unsubscribe = await listenToAgentSessionEvents({
    adapter,
    repoPath,
    externalSessionId: sessionRef?.externalSessionId ?? "session-1",
    ...(sessionRef ? { sessionRef } : {}),
    sessionsRef,
    updateSession,
    ...(updateSessionTodos ? { updateSessionTodos } : {}),
    ...(eventBatchWindowMs !== undefined ? { eventBatchWindowMs } : {}),
    resolveTurnDurationMs: () => undefined,
    clearTurnDuration: () => {},
  });

  const handleEvent = handlers[0];
  if (!handleEvent) {
    throw new Error("Expected session event handler to be registered");
  }

  return {
    handleEvent,
    sessionTwoRef,
    sessionsRef,
    unsubscribe,
  };
};

const createDirectRouterContext = ({
  sessionRef,
  sessions,
  onUpdateSession,
}: {
  sessionRef: PolicyBoundSessionRef;
  sessions: AgentSessionState[];
  onUpdateSession?: Parameters<typeof createSessionEventRouter>[0]["context"]["updateSession"];
}) => {
  const sessionsRef = createSessionsRef(sessions);
  const updateSession = createSessionUpdater(sessionsRef);
  const readSession = (identity: Parameters<typeof updateSession>[0]) =>
    getAgentSession(sessionsRef.current, identity);
  const ensureSession: Parameters<typeof createSessionEventRouter>[0]["context"]["ensureSession"] =
    (identity, createSession) => {
      const current = readSession(identity);
      if (current) {
        return current;
      }
      return createSession();
    };

  return {
    context: {
      adapter: {
        subscribeEvents: async () => () => {},
        replyApproval: async () => {},
      },
      sessionRef,
      turnMetadata: createSessionTurnMetadata(),
      readSession,
      ensureSession,
      updateSession: onUpdateSession ?? updateSession,
      updateSessionTodos: () => {},
      isSessionObserved: () => true,
      recordTurnActivityTimestamp: () => {},
      recordTurnUserMessageTimestamp: () => {},
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      buildReadOnlyApprovalRejectionMessage: async () => "",
      readOnlyApprovalAutoRejectSafe: true,
    },
    sessionsRef,
    updateSession,
  };
};

describe("agent-orchestrator session event routing", () => {
  test("routes events for another stream session to that session transcript", async () => {
    const { handleEvent, sessionTwoRef, sessionsRef, unsubscribe } = await createRoutingHarness();

    try {
      handleEvent(
        userMessageEvent({
          message: "Route to session 2",
          messageId: "user-session-2",
          sessionRef: sessionTwoRef,
        }),
      );

      expect(getSessionMessages(sessionsRef, "session-1")).toEqual([]);
      expect(
        getSessionMessages(sessionsRef, "session-2").map((message) => message.content),
      ).toEqual(["Route to session 2"]);
    } finally {
      unsubscribe();
    }
  });

  test("keeps queued transcript batches isolated by stream event session", async () => {
    const { handleEvent, sessionTwoRef, sessionsRef, unsubscribe } = await createRoutingHarness({
      eventBatchWindowMs: 500,
    });

    try {
      handleEvent(assistantPartEvent({ text: "Session 1 draft" }));
      handleEvent(assistantPartEvent({ text: "Session 2 draft", sessionRef: sessionTwoRef }));

      unsubscribe();

      expect(
        getSessionMessages(sessionsRef, "session-1").map((message) => message.content),
      ).toEqual(["Session 1 draft"]);
      expect(
        getSessionMessages(sessionsRef, "session-2").map((message) => message.content),
      ).toEqual(["Session 2 draft"]);
    } finally {
      unsubscribe();
    }
  });

  test("does not flush another session queue before an immediate stream event", async () => {
    const { handleEvent, sessionTwoRef, sessionsRef, unsubscribe } = await createRoutingHarness({
      eventBatchWindowMs: 500,
    });

    try {
      handleEvent(assistantPartEvent({ text: "Session 1 draft" }));

      handleEvent(
        userMessageEvent({
          message: "Session 2 immediate message",
          messageId: "user-session-2",
          sessionRef: sessionTwoRef,
        }),
      );

      expect(getSessionMessages(sessionsRef, "session-1")).toEqual([]);
      expect(
        getSessionMessages(sessionsRef, "session-2").map((message) => message.content),
      ).toEqual(["Session 2 immediate message"]);

      unsubscribe();

      expect(
        getSessionMessages(sessionsRef, "session-1").map((message) => message.content),
      ).toEqual(["Session 1 draft"]);
    } finally {
      unsubscribe();
    }
  });

  test("routes session todo updates to the stream event session", async () => {
    const todosBySessionId = new Map<string, AgentSessionTodoItem[]>();
    const { handleEvent, sessionTwoRef, unsubscribe } = await createRoutingHarness({
      updateSessionTodos: (session, updater) => {
        const current = todosBySessionId.get(session.externalSessionId) ?? [];
        todosBySessionId.set(session.externalSessionId, updater(current));
      },
    });

    try {
      handleEvent({
        type: "session_todos_updated",
        externalSessionId: "session-2",
        timestamp: "2026-02-22T08:00:03.000Z",
        sessionRef: sessionTwoRef,
        todos: [{ id: "todo-2", content: "Session 2 todo", status: "pending", priority: "medium" }],
      });

      expect(todosBySessionId.get("session-1")).toBeUndefined();
      expect(todosBySessionId.get("session-2")).toEqual([
        { id: "todo-2", content: "Session 2 todo", status: "pending", priority: "medium" },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("rejects cross-session events without a full session ref", async () => {
    const { handleEvent, sessionsRef, unsubscribe } = await createRoutingHarness();

    try {
      expect(() =>
        handleEvent({
          type: "session_idle",
          externalSessionId: "session-2",
          timestamp: "2026-02-22T08:00:03.000Z",
        }),
      ).toThrow("without a full session ref");

      expect(getSessionMessages(sessionsRef, "session-1")).toEqual([]);
      expect(getSessionMessages(sessionsRef, "session-2")).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("routes queued events to the matching worktree when external ids collide", async () => {
    const rootRef = routeRef({
      externalSessionId: "shared-session",
      workingDirectory: "/tmp/repo",
    });
    const worktreeRef: SessionRef = {
      ...rootRef,
      workingDirectory: "/tmp/repo/worktrees/shared-session",
    };
    const { handleEvent, sessionsRef, unsubscribe } = await createRoutingHarness({
      eventBatchWindowMs: 500,
      sessionRef: rootRef,
      sessions: [
        buildSession({
          externalSessionId: rootRef.externalSessionId,
          workingDirectory: rootRef.workingDirectory,
        }),
        buildSession({
          externalSessionId: worktreeRef.externalSessionId,
          workingDirectory: worktreeRef.workingDirectory,
        }),
      ],
    });

    try {
      handleEvent(
        assistantPartEvent({
          text: "Worktree draft",
          messageId: "assistant-worktree",
          partId: "text-worktree",
          sessionRef: worktreeRef,
        }),
      );

      unsubscribe();

      expect(getSessionMessagesByIdentity(sessionsRef, rootRef)).toEqual([]);
      expect(
        getSessionMessagesByIdentity(sessionsRef, worktreeRef).map((message) => message.content),
      ).toEqual(["Worktree draft"]);
    } finally {
      unsubscribe();
    }
  });

  test("unsubscribes even when teardown flush throws", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    let unsubscribed = false;
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_sessionRef, handler) => {
        handlers.push(handler);
        return () => {
          unsubscribed = true;
        };
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    const updateSession: SessionUpdateFn = () => {
      throw new Error("flush failed");
    };

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 500,
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }
    handleEvent(assistantMessageEvent({ message: "Queued answer" }));

    expect(() => unsubscribe()).toThrow("flush failed");
    expect(unsubscribed).toBe(true);
  });

  test("does not throttle queued events across worktrees that share an external id", async () => {
    const rootRef = routeRef({
      externalSessionId: "shared-session",
      workingDirectory: "/tmp/repo",
    });
    const worktreeRef: SessionRef = {
      ...rootRef,
      workingDirectory: "/tmp/repo/worktrees/shared-session",
    };
    const { handleEvent, sessionsRef, unsubscribe } = await createRoutingHarness({
      eventBatchWindowMs: 0,
      sessionRef: rootRef,
      sessions: [
        buildSession({
          externalSessionId: rootRef.externalSessionId,
          workingDirectory: rootRef.workingDirectory,
        }),
        buildSession({
          externalSessionId: worktreeRef.externalSessionId,
          workingDirectory: worktreeRef.workingDirectory,
        }),
      ],
    });

    try {
      handleEvent(
        assistantMessageEvent({
          message: "Root answer",
          messageId: "assistant-shared",
          sessionRef: rootRef,
        }),
      );
      handleEvent(
        assistantMessageEvent({
          message: "Worktree answer",
          messageId: "assistant-shared",
          sessionRef: worktreeRef,
        }),
      );

      expect(
        getSessionMessagesByIdentity(sessionsRef, rootRef).map((message) => message.content),
      ).toEqual(["Root answer"]);
      expect(
        getSessionMessagesByIdentity(sessionsRef, worktreeRef).map((message) => message.content),
      ).toEqual(["Worktree answer"]);
    } finally {
      unsubscribe();
    }
  });

  test("delegates durable writes for sessions outside the queued batch", () => {
    const rootRef = routeRef();
    const sessionTwoRef = routeRef({
      externalSessionId: "session-2",
      workingDirectory: "/tmp/repo/worktrees/session-2",
    });
    const updateOptions: unknown[] = [];
    const { context, sessionsRef, updateSession } = createDirectRouterContext({
      sessionRef: rootRef,
      sessions: [
        buildSession({ externalSessionId: rootRef.externalSessionId }),
        buildSession({
          externalSessionId: sessionTwoRef.externalSessionId,
          workingDirectory: sessionTwoRef.workingDirectory,
        }),
      ],
      onUpdateSession: (identity, updater, options) => {
        updateOptions.push(options);
        return updateSession(identity, updater);
      },
    });
    const router = createSessionEventRouter({
      createBatcher: createSessionEventBatcher,
      context,
      handleEvent: (eventContext) => {
        eventContext.store.updateSession(
          sessionTwoRef,
          (current) => ({ ...current, status: "idle" }),
          { persist: true },
        );
      },
    });

    router.enqueue(assistantMessageEvent({ message: "Root batch", sessionRef: rootRef }));

    expect(() => router.flushReady()).not.toThrow();
    expect(getSession(sessionsRef, "session-2").status).toBe("idle");
    expect(updateOptions).toContainEqual({ persist: true });
  });

  test("clears a routed session batcher after a forced flush", () => {
    const rootRef = routeRef();
    const { context } = createDirectRouterContext({
      sessionRef: rootRef,
      sessions: [buildSession({ externalSessionId: rootRef.externalSessionId })],
    });
    const prepareCalls: number[] = [];
    let nextBatcherId = 0;
    const router = createSessionEventRouter({
      createBatcher: () => {
        nextBatcherId += 1;
        const batcherId = nextBatcherId;
        return {
          prepareQueuedSessionEvents: (events) => {
            prepareCalls.push(batcherId);
            return { readyEvents: events, deferredEvents: [], nextDelayMs: null };
          },
        };
      },
      context,
      handleEvent: () => {},
    });

    router.enqueue(
      assistantMessageEvent({ message: "First ready event", messageId: "assistant-1" }),
    );
    router.flushReady();
    router.enqueue(assistantMessageEvent({ message: "Forced event", messageId: "assistant-2" }));
    router.flushAll();
    router.enqueue(
      assistantMessageEvent({ message: "Second ready event", messageId: "assistant-3" }),
    );
    router.flushReady();

    expect(prepareCalls).toEqual([1, 2]);
  });
});

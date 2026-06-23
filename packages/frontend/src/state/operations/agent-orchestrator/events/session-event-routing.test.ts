import { describe, expect, test } from "bun:test";
import type { AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import {
  type AgentSessionState,
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSessionMessages,
  getSessionMessagesByIdentity,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
} from "./session-events-test-harness";

const routeRef = (overrides: Partial<AgentSessionRef> = {}): AgentSessionRef => ({
  externalSessionId: "session-1",
  repoPath: "/tmp/repo",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo",
  ...overrides,
});

const userMessageEvent = ({
  message,
  messageId,
  sessionRef,
}: {
  message: string;
  messageId: string;
  sessionRef?: AgentSessionRef;
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
  sessionRef?: AgentSessionRef;
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
  sessionRef?: AgentSessionRef;
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
  sessionRef?: AgentSessionRef;
  sessions?: AgentSessionState[];
  updateSessionTodos?: (
    session: AgentSessionRef,
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
  const sessionTwoRef: AgentSessionRef = {
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
    refreshTaskData: async () => {},
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

    handleEvent(assistantPartEvent({ text: "Session 1 draft" }));
    handleEvent(assistantPartEvent({ text: "Session 2 draft", sessionRef: sessionTwoRef }));

    unsubscribe();

    expect(getSessionMessages(sessionsRef, "session-1").map((message) => message.content)).toEqual([
      "Session 1 draft",
    ]);
    expect(getSessionMessages(sessionsRef, "session-2").map((message) => message.content)).toEqual([
      "Session 2 draft",
    ]);
  });

  test("does not flush another session queue before an immediate stream event", async () => {
    const { handleEvent, sessionTwoRef, sessionsRef, unsubscribe } = await createRoutingHarness({
      eventBatchWindowMs: 500,
    });

    handleEvent(assistantPartEvent({ text: "Session 1 draft" }));

    handleEvent(
      userMessageEvent({
        message: "Session 2 immediate message",
        messageId: "user-session-2",
        sessionRef: sessionTwoRef,
      }),
    );

    expect(getSessionMessages(sessionsRef, "session-1")).toEqual([]);
    expect(getSessionMessages(sessionsRef, "session-2").map((message) => message.content)).toEqual([
      "Session 2 immediate message",
    ]);

    unsubscribe();

    expect(getSessionMessages(sessionsRef, "session-1").map((message) => message.content)).toEqual([
      "Session 1 draft",
    ]);
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
    const worktreeRef: AgentSessionRef = {
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
  });

  test("does not throttle queued events across worktrees that share an external id", async () => {
    const rootRef = routeRef({
      externalSessionId: "shared-session",
      workingDirectory: "/tmp/repo",
    });
    const worktreeRef: AgentSessionRef = {
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
});

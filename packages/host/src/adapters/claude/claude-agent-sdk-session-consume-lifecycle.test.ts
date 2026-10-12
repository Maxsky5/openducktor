import { describe, expect, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { consumeClaudeSession, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  emptyClaudeQuery,
  ignoreClaudeBackgroundFailure,
  openClaudeQueryWithMessages,
  throwingClaudeQuery,
  waitForTimers,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import type { ClaudeAgentSdkEventEmitter } from "./claude-agent-sdk-types";

const MESSAGE_ID = "00000000-0000-4000-8000-000000000001";

describe("consumeClaudeSession lifecycle", () => {
  test("sends the first resumed user message after an unattributed running replay", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const sessionStore = createClaudeAgentSdkSessionStore();
    const openQuery = openClaudeQueryWithMessages([
      claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "running",
        uuid: "99de2643-2919-47bc-8869-40bed873ae40",
        session_id: "session-1",
      }),
    ]);
    const session = createClaudeSession({
      activity: "idle",
      query: openQuery.query,
      queue,
    });
    sessionStore.set(session);

    const consumePromise = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    await waitForTimers();

    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:01.000Z",
      randomId: () => MESSAGE_ID,
      emit: (_session, event) => events.push(event),
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        delivery: "new_turn",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "Hi" }],
      },
    });

    expect(accepted.state).toBe("read");
    expect(pushed).toEqual([
      expect.objectContaining({
        type: "user",
        uuid: MESSAGE_ID,
      }),
    ]);

    sessionStore.sessions.delete(session.externalSessionId);
    openQuery.release();
    await consumePromise;
  });

  test("keeps terminal assistant frames running until the SDK result arrives", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const openQuery = openClaudeQueryWithMessages([
      claudeSdkMessageFixture({
        type: "assistant",
        uuid: "43b2a0dd-fded-4c7e-86ec-8816daecd43d",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        },
      }),
    ]);
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: MESSAGE_ID,
          parts: [{ kind: "text", text: "write the spec" }],
          text: "write the spec",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
      ],
      activeSdkUserTurnCount: 1,
      activity: "running",
      pendingUserTurnCount: 1,
      query: openQuery.query,
      sdkState: "running",
    });
    sessionStore.set(session);

    const consumePromise = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:02.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });

    await waitForTimers();

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);

    sessionStore.sessions.delete(session.externalSessionId);
    openQuery.release();
    await consumePromise;
  });

  test("terminalizes a live session when the SDK iterator completes", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      activity: "running",
      query: emptyClaudeQuery(),
    });
    sessionStore.set(session);

    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });

    expect(session.activity).toBe("stopped");
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(events).toEqual([
      {
        type: "session_finished",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        message: "Claude Agent SDK session stream ended.",
      },
    ]);
  });

  test("terminalizes a live session when the SDK iterator fails", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      activity: "running",
      query: throwingClaudeQuery(new Error("transport crashed")),
    });
    sessionStore.set(session);

    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });

    expect(session.activity).toBe("stopped");
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(events).toEqual([
      {
        type: "session_error",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        message: "transport crashed",
      },
      {
        type: "session_finished",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        message: "Claude Agent SDK session stream stopped after an error.",
      },
    ]);

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:01.000Z",
        randomId: () => MESSAGE_ID,
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          delivery: "new_turn",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "retry" }],
        },
      }),
    ).rejects.toThrow(
      "Claude Agent SDK session is no longer accepting messages after its SDK stream stopped.",
    );
  });

  test("drains a live context refresh before finishing a failed SDK stream", async () => {
    const events: AgentEvent[] = [];
    const backgroundFailures: unknown[] = [];
    const contextRefreshStarted = Promise.withResolvers<void>();
    const contextUsage = Promise.withResolvers<{ totalTokens: number; maxTokens: number }>();
    const queryClosed = Promise.withResolvers<void>();
    const sessionFailed = Promise.withResolvers<void>();
    const query = Object.assign(
      throwingClaudeQuery(new Error("transport crashed"), [
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "43b2a0dd-fded-4c7e-86ec-8816daecd43d",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            stop_reason: null,
            content: [{ type: "text", text: "Working..." }],
          },
        }),
      ]),
      {
        getContextUsage: () => {
          contextRefreshStarted.resolve();
          return contextUsage.promise;
        },
        close: () => queryClosed.resolve(),
      },
    );
    const emit: ClaudeAgentSdkEventEmitter = (_session, event): void => {
      events.push(event);
      if (event.type === "session_error") {
        sessionFailed.resolve();
      }
    };
    const sessionStore = createClaudeAgentSdkSessionStore({
      emit,
      now: () => "2026-06-25T20:00:03.000Z",
    });
    const session = createClaudeSession({
      activity: "running",
      query,
    });
    sessionStore.set(session);

    const consumePromise = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:02.000Z",
      emit,
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          backgroundFailures.push(failure);
        }),
    });

    await Promise.all([contextRefreshStarted.promise, sessionFailed.promise]);

    expect(sessionStore.get(session.externalSessionId)).toBe(session);
    expect(session.activity).toBe("stopped");
    expect(events.some((event) => event.type === "session_error")).toBe(true);
    expect(events.some((event) => event.type === "session_finished")).toBe(false);

    const stopPromise = Effect.runPromise(sessionStore.stopSessionsForRuntime(session.runtimeId));
    await queryClosed.promise;
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();

    contextUsage.resolve({
      totalTokens: 42_000,
      maxTokens: 200_000,
    });
    await Promise.all([consumePromise, stopPromise]);

    expect(
      events
        .filter(
          (event) =>
            event.type === "session_error" ||
            event.type === "session_context_updated" ||
            event.type === "session_finished",
        )
        .map((event) => event.type),
    ).toEqual(["session_error", "session_context_updated", "session_finished"]);
    expect(backgroundFailures).toEqual([]);
  });

  test("marks a stream that ended after a replacement took the store key as stopped", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:02.000Z",
    });
    const session = createClaudeSession({
      activity: "running",
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "a1b2c3d4-0000-4000-8000-000000000001",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            stop_reason: null,
            content: [{ type: "text", text: "Working..." }],
          },
        }),
      ]),
    });
    const replacement = createClaudeSession({ activity: "running" });
    sessionStore.set(session);
    const emit: ClaudeAgentSdkEventEmitter = (_target, event): void => {
      events.push(event);
      sessionStore.set(replacement);
    };

    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:02.000Z",
      emit,
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });

    expect(session.activity).toBe("stopped");
    expect(sessionStore.get(session.externalSessionId)).toBe(replacement);
    expect(events.some((event) => event.type === "session_finished")).toBe(false);
  });
});

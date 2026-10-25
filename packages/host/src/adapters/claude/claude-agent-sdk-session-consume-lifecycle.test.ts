import { describe, expect, mock, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { consumeClaudeSession, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  createClaudeContextUsageResponse,
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
  test.each(["session", "runtime"])("%s stop joins native consumer teardown", async (scope) => {
    const returning = Promise.withResolvers<void>();
    const returned = Promise.withResolvers<void>();
    const events: string[] = [];
    const emit: ClaudeAgentSdkEventEmitter = (_session, event) => {
      events.push(event.type);
    };
    const sessionStore = createClaudeAgentSdkSessionStore({ emit });
    const open = openClaudeQueryWithMessages([]);
    const nativeReturn = open.query.return.bind(open.query);
    open.query.return = async () => {
      returning.resolve();
      await returned.promise;
      return nativeReturn(undefined);
    };
    const session = createClaudeSession({ query: open.query });
    sessionStore.set(session);
    const consumption = consumeClaudeSession({
      session,
      sessionStore,
      emit,
      now: () => "2026-06-25T20:00:00.000Z",
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    let stopped = false;
    const stopping = Effect.runPromise(
      scope === "runtime"
        ? sessionStore.stopSessionsForRuntime(session.runtimeId)
        : sessionStore.stopSession({
            runtimeKind: "claude",
            workingDirectory: "/repo",
            externalSessionId: session.externalSessionId,
          }),
    ).then(() => {
      stopped = true;
    });
    try {
      await returning.promise;
      expect(stopped).toBe(false);
      expect(events).toEqual([]);
    } finally {
      returned.resolve();
      open.release();
      await Promise.all([consumption, stopping]);
    }
    expect(stopped).toBe(true);
    expect(events).toEqual(["session_finished"]);
    expect(session.query.close).toHaveBeenCalledTimes(1);
  });

  test("runtime shutdown joins a consumer already removed from the registry", async () => {
    const returning = Promise.withResolvers<void>();
    const returned = Promise.withResolvers<void>();
    const sessionStore = createClaudeAgentSdkSessionStore();
    const query = emptyClaudeQuery();
    query.return = async () => {
      returning.resolve();
      await returned.promise;
      return { done: true, value: undefined };
    };
    const session = createClaudeSession({ query });
    sessionStore.set(session);
    const consumption = consumeClaudeSession({
      session,
      sessionStore,
      emit: () => {},
      now: () => "2026-06-25T20:00:00.000Z",
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    await returning.promise;
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    let stopped = false;
    const stopping = Effect.runPromise(sessionStore.stopSessionsForRuntime(session.runtimeId)).then(
      () => {
        stopped = true;
      },
    );
    await waitForTimers();
    try {
      expect(stopped).toBe(false);
    } finally {
      returned.resolve();
      await Promise.all([consumption, stopping]);
    }
  });

  test("runtime shutdown joins replaced consumers without publishing their terminal events", async () => {
    const oldReturned = Promise.withResolvers<void>();
    const replacementFinished = Promise.withResolvers<void>();
    const events: string[] = [];
    const old = openClaudeQueryWithMessages([]);
    const current = openClaudeQueryWithMessages([]);
    old.query.return = async () => {
      await oldReturned.promise;
      return { done: true, value: undefined };
    };
    const session = createClaudeSession({ query: old.query });
    const replacement = createClaudeSession({ query: current.query });
    const emit: ClaudeAgentSdkEventEmitter = (target, event) => {
      if (event.type === "session_finished") {
        events.push(target === replacement ? "replacement" : "old");
        if (target === replacement) replacementFinished.resolve();
      }
    };
    const sessionStore = createClaudeAgentSdkSessionStore({ emit });
    const consume = (target: typeof session) =>
      consumeClaudeSession({
        session: target,
        sessionStore,
        emit,
        now: () => "2026-06-25T20:00:00.000Z",
        onBackgroundFailure: ignoreClaudeBackgroundFailure,
      });
    sessionStore.set(session);
    const oldConsumption = consume(session);
    sessionStore.set(replacement);
    const consumption = consume(replacement);
    const stopping = Effect.runPromise(sessionStore.stopSessionsForRuntime(session.runtimeId));
    await replacementFinished.promise;
    oldReturned.resolve();
    await Promise.all([oldConsumption, consumption, stopping]);
    expect(events).toEqual(["replacement"]);
    expect(old.query.close).toHaveBeenCalledTimes(1);
    expect(current.query.close).toHaveBeenCalledTimes(1);
  });

  test.each(["session_finished", "session_error"])(
    "cleans up and reports a throwing %s subscriber without repeating terminal delivery",
    async (failingEvent) => {
      const deliveryError = new Error("subscriber failed");
      const streamError = new Error("stream failed");
      const events: string[] = [];
      const failures: unknown[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const session = createClaudeSession({
        query:
          failingEvent === "session_error" ? throwingClaudeQuery(streamError) : emptyClaudeQuery(),
      });
      sessionStore.set(session);

      const failure = await consumeClaudeSession({
        session,
        sessionStore,
        now: () => "2026-06-25T20:00:00.000Z",
        emit: (_session, event) => {
          events.push(event.type);
          if (event.type === failingEvent) throw deliveryError;
        },
        onBackgroundFailure: (failure) =>
          Effect.sync(() => {
            failures.push(failure);
          }),
      }).catch((cause: unknown) => cause);

      expect(session.query.close).toHaveBeenCalledTimes(1);
      expect(session.abortController.signal.aborted).toBe(true);
      expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
      expect(events.filter((type) => type === "session_finished")).toHaveLength(1);
      expect(failures).toEqual([failure]);
      expect(failure).toMatchObject({ operation: "claudeRuntime.consumeSession" });
      if (failingEvent === "session_error") {
        expect(failure).toMatchObject({
          cause: expect.objectContaining({ errors: [streamError, deliveryError] }),
        });
      } else {
        expect(failure).toMatchObject({ cause: deliveryError });
      }
    },
  );

  test("preserves structured stream, delivery, and cleanup errors through settlement", async () => {
    const streamError = new HostOperationError({
      operation: "claude.native.read",
      message: "Restore session X failed",
      cause: new Error("socket reset"),
      details: { session: "X" },
    });
    const deliveryError = new AggregateError(
      [new Error("subscriber unavailable")],
      "Session error delivery failed",
    );
    const cleanupError = new HostOperationError({
      operation: "claude.native.close",
      message: "Teardown session X failed",
      cause: new Error("process close failed"),
      details: { session: "X", resource: "query" },
    });
    const failures: HostOperationErrorAggregate[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({ query: throwingClaudeQuery(streamError) });
    session.query.close = mock(() => {
      throw cleanupError;
    });
    sessionStore.set(session);
    const consumption = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => {
        if (event.type === "session_error") throw deliveryError;
      },
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          failures.push(failure);
        }),
    });
    const failure = await consumption.catch((cause: unknown) => cause);
    expect(failures).toHaveLength(1);
    expect(failure).toBe(failures[0]);
    expect(failure).toMatchObject({
      message: "Restore session X failed\nSession error delivery failed\nTeardown session X failed",
    });
    const causes = failures[0]?.cause;
    if (!(causes instanceof AggregateError))
      throw new Error("Expected combined lifecycle failures.");
    expect(causes.errors).toHaveLength(3);
    expect(causes.errors[0]).toBe(streamError);
    expect(causes.errors[1]).toBe(deliveryError);
    expect(causes.errors[2]).toBe(cleanupError);
    const settled = await Effect.runPromise(sessionStore.settle(session)).catch(
      (cause: unknown) => cause,
    );
    expect(settled).toMatchObject({
      cause: expect.objectContaining({
        errors: expect.arrayContaining([cleanupError, streamError, deliveryError]),
      }),
    });
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(session.query.close).toHaveBeenCalledTimes(1);
  });

  test("keeps stream and close failures while completing local cleanup", async () => {
    const streamError = new Error("stream failed");
    const closeError = new Error("close failed");
    const returnError = new Error("return failed");
    const failures: unknown[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const closed = mock(() => {});
    sessionStore.subscribeClose(closed);
    const session = createClaudeSession({ query: throwingClaudeQuery(streamError) });
    session.query.close = mock(() => {
      throw closeError;
    });
    session.query.return = mock(async () => {
      throw returnError;
    });
    sessionStore.set(session);
    const failure = await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: () => {},
      onBackgroundFailure: (cause) =>
        Effect.sync(() => {
          failures.push(cause);
        }),
    }).catch((cause: unknown) => cause);

    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({
      operation: "claudeRuntime.consumeSession",
      cause: expect.objectContaining({
        errors: expect.arrayContaining([streamError, closeError, returnError]),
      }),
    });
    expect(failures).toEqual([failure]);
  });

  test("context and context-error delivery failures cannot prevent finalization", async () => {
    const reading = Promise.withResolvers<void>();
    const context = Promise.withResolvers<ReturnType<typeof createClaudeContextUsageResponse>>();
    const failures: unknown[] = [];
    const events: string[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: MESSAGE_ID,
          session_id: "session-1",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "Done" }],
          },
        }),
      ]),
    });
    session.query.getContextUsage = () => {
      reading.resolve();
      return context.promise;
    };
    sessionStore.set(session);
    const consumption = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => {
        events.push(event.type);
        if (event.type === "session_context_updated" || event.type === "session_context_error")
          throw new Error("context subscriber failed");
      },
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          failures.push(failure);
        }),
    });
    await reading.promise;
    await waitForTimers();
    context.resolve(createClaudeContextUsageResponse(100, 1000));
    await expect(consumption).rejects.toThrow("context subscriber failed");
    expect(session.query.close).toHaveBeenCalledTimes(1);
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(events.slice(-3)).toEqual([
      "session_context_updated",
      "session_context_error",
      "session_finished",
    ]);
    expect(failures).toContainEqual(
      expect.objectContaining({ operation: "claudeRuntime.consumeSession" }),
    );
  });

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

  test("keeps a reported SDK stream failure within its session", async () => {
    const events: AgentEvent[] = [];
    const onBackgroundFailure = mock(() => Effect.void);
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      activity: "running",
      query: throwingClaudeQuery(new Error("transport crashed")),
    });
    sessionStore.set(session);

    const consumption = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure,
    });

    await expect(consumption).resolves.toBeUndefined();
    expect(onBackgroundFailure).not.toHaveBeenCalled();
    expect(session.query.close).toHaveBeenCalledTimes(1);

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

    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
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
    expect(session.query.close).toHaveBeenCalledTimes(1);
    expect(replacement.query.close).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "session_finished")).toBe(false);
  });
});

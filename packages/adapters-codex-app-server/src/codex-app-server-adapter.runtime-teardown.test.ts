import { describe, expect, test } from "bun:test";
import type {
  CodexAppServerTurnStartResult,
  CodexAppServerTurnSteerResult,
} from "@openducktor/contracts";
import {
  type AgentEvent,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
} from "@openducktor/core";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexTurnFixture,
  codexUserMessageInput,
  createAdapterWithTransport,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import { CodexMessageAcceptedError } from "./codex-message-accepted-error";
import { releaseCodexRuntimeState } from "./codex-runtime-cleanup";
import type { CodexLiveSessionMutation } from "./types";

const failureOf = (promise: Promise<unknown>): Promise<Error | null> =>
  promise.then(
    () => null,
    (error: Error) => error,
  );

class RejectableTurnTransport extends RecordingTransport {
  private readonly turnStartFailure = createDeferred<never>();

  constructor() {
    super("runtime-live", false);
  }

  failTurnStart(error: Error): void {
    this.turnStartFailure.reject(error);
  }

  async request(request: Parameters<RecordingTransport["request"]>[0]) {
    if (request.method === "turn/start") {
      this.calls.push(request);
      return await this.turnStartFailure.promise;
    }
    return super.request(request);
  }
}

class DeferredSteerTransport extends RecordingTransport {
  readonly turnStartRequested = createDeferred<void>();
  readonly steerRequested = createDeferred<void>();
  private readonly turnStartResponse = createDeferred<CodexAppServerTurnStartResult>();
  private readonly steerResponse = createDeferred<CodexAppServerTurnSteerResult>();

  constructor() {
    super("runtime-live", false);
  }

  completeTurnStart(): void {
    this.turnStartResponse.resolve({
      turn: codexTurnFixture({ id: "turn-active", items: [], status: "inProgress" }),
    });
  }

  completeSteer(): void {
    this.steerResponse.resolve({ turnId: "turn-active" });
  }

  failSteer(error: Error): void {
    this.steerResponse.reject(error);
  }

  async request(request: Parameters<RecordingTransport["request"]>[0]) {
    if (request.method === "turn/start") {
      this.calls.push(request);
      this.turnStartRequested.resolve();
      return this.turnStartResponse.promise;
    }
    if (request.method === "turn/steer") {
      this.calls.push(request);
      this.steerRequested.resolve();
      return this.steerResponse.promise;
    }
    return super.request(request);
  }
}

describe("CodexAppServerAdapter runtime teardown", () => {
  test("attempts every runtime-state cleanup when one component fails", () => {
    const cleanupCalls: string[] = [];
    expect(() =>
      releaseCodexRuntimeState("runtime-live", {
        cancelContextUsage: () => cleanupCalls.push("context:runtime-live"),
        releaseSessions: () => {
          cleanupCalls.push("sessions:runtime-live");
          throw new Error("unsubscribe failed");
        },
        clearPendingInput: () => cleanupCalls.push("pending:runtime-live"),
        clearSubagents: () => cleanupCalls.push("subagents:runtime-live"),
        clearRuntimeEvents: () => cleanupCalls.push("events:runtime-live"),
        disposeThreadInventory: () => cleanupCalls.push("inventory:runtime-live"),
      }),
    ).toThrow("unsubscribe failed");
    expect(cleanupCalls).toEqual([
      "context:runtime-live",
      "sessions:runtime-live",
      "pending:runtime-live",
      "subagents:runtime-live",
      "events:runtime-live",
      "inventory:runtime-live",
    ]);
  });

  test("ignores terminal turn completion from a disposed runtime owner", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const send = failureOf(
      adapter.sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "Complete after release" }],
        }),
      ),
    );
    await flushCodexAdapterWork();
    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "active", activeFlags: [] },
      },
    });
    await flushCodexAdapterWork();

    const transport = transports.get("runtime-live");
    if (!transport) {
      throw new Error("Expected the runtime transport to retain the deferred turn.");
    }
    transport.turnStartDeferred.resolve({
      turn: codexTurnFixture({ id: "turn-late", items: [], status: "completed" }),
    });
    await send;
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ availability: "runtime", classification: "running" });
  });

  test("does not begin a turn after runtime release wins subscription readiness", async () => {
    const { adapter } = createHarness();

    await adapter.startSession(codexStartSessionInput());
    const send = adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "Race runtime release" }],
      }),
    );
    adapter.releaseRuntime("runtime-live");

    await expect(send).rejects.toThrow("Unknown Codex session 'thread/start-runtime-live'.");
  });

  test("rejects settings when the runtime releases the session during catalog validation", async () => {
    const validationStarted = createDeferred<void>();
    const allowValidation = createDeferred<void>();
    const transport = new RecordingTransport("runtime-live", false);
    const request = transport.request.bind(transport);
    transport.request = async (input) => {
      if (input.method === "model/list") {
        validationStarted.resolve();
        await allowValidation.promise;
      }
      return request(input);
    };
    const adapter = createAdapterWithTransport(transport);
    await adapter.resumeSession({ ...codexSessionRuntimeRef(), model: undefined });
    const updating = failureOf(
      adapter.updateSessionModel({
        ...codexSessionRuntimeRef(),
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    await validationStarted.promise;
    adapter.releaseRuntime("runtime-live");
    allowValidation.resolve();
    expect((await updating)?.message).toContain("session closed");
    expect(transport.calls.some((call) => call.method === "turn/start")).toBe(false);
  });

  test("a rejected explicit settings change leaves accepted settings available for Send", async () => {
    const { adapter, transports } = createHarness();
    await adapter.startSession(codexStartSessionInput());
    await expect(
      adapter.updateSessionModel({
        ...codexSessionRuntimeRef(),
        model: { providerId: "openai", modelId: "gpt-unknown", variant: "medium" },
      }),
    ).rejects.toThrow("gpt-unknown");
    const transport = transports.get("runtime-live");
    if (!transport) throw new Error("Expected a runtime transport");
    const before = transport.calls.length;
    await adapter.sendUserMessage(codexUserMessageInput({ parts: [{ kind: "text", text: "Go" }] }));
    expect(
      transport.calls
        .slice(before)
        .some((call) => call.method === "model/list" || call.method === "thread/resume"),
    ).toBe(false);
    expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
      model: "gpt-5",
      effort: "medium",
    });
  });

  test("does not report a released turn failure to a replacement session", async () => {
    const transport = new RejectableTurnTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const send = failureOf(
      adapter.sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "Fail after release" }],
        }),
      ),
    );
    await flushCodexAdapterWork();
    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());

    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      transport.failTurnStart(new Error("old turn failed"));
      expect(await send).toBeInstanceOf(Error);
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("does not report a late dynamic-tool rejection to a replacement session", async () => {
    const responseStarted = createDeferred<void>();
    const responseCompleted = createDeferred<void>();
    const { subscribeEvents, emitServerRequest } = createRuntimeStreamSubscription();
    const liveMutations: CodexLiveSessionMutation[] = [];
    const { adapter } = createHarness({
      subscribeEvents,
      respondServerRequest: async () => {
        responseStarted.resolve();
        await responseCompleted.promise;
      },
      onLiveSessionMutation: (mutation) => {
        liveMutations.push(mutation);
      },
    });

    await adapter.startSession(codexStartSessionInput());
    emitServerRequest({
      id: "late-dynamic-tool",
      method: "item/tool/call",
      params: {
        arguments: {},
        callId: "late-dynamic-tool-call",
        namespace: null,
        threadId: "thread/start-runtime-live",
        tool: "test_tool",
        turnId: "old-turn",
      },
    });
    await responseStarted.promise;

    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      responseCompleted.resolve();
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
      expect(liveMutations).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("does not report a late server-request response failure to a replacement session", async () => {
    const responseStarted = createDeferred<void>();
    const responseCompleted = createDeferred<void>();
    const { subscribeEvents, emitServerRequest } = createRuntimeStreamSubscription();
    const liveMutations: CodexLiveSessionMutation[] = [];
    const { adapter } = createHarness({
      subscribeEvents,
      respondServerRequest: async () => {
        responseStarted.resolve();
        await responseCompleted.promise;
      },
      onLiveSessionMutation: (mutation) => {
        liveMutations.push(mutation);
      },
    });

    await adapter.startSession(codexStartSessionInput());
    emitServerRequest({
      id: "failed-dynamic-tool",
      method: "item/tool/call",
      params: {
        arguments: {},
        callId: "failed-dynamic-tool-call",
        namespace: null,
        threadId: "thread/start-runtime-live",
        tool: "test_tool",
        turnId: "old-turn",
      },
    });
    await responseStarted.promise;

    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      responseCompleted.reject(new Error("old server-request response failed"));
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
      expect(liveMutations).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("returns a refused turn to the caller instead of the session stream", async () => {
    const transport = new RejectableTurnTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    try {
      const send = failureOf(
        adapter.sendUserMessage(
          codexUserMessageInput({
            parts: [{ kind: "text", text: "Fail while retained" }],
          }),
        ),
      );
      await flushCodexAdapterWork();
      transport.failTurnStart(
        new AgentSessionMessageRefusedError(new Error("current turn failed")),
      );

      expect((await send)?.message).toContain("current turn failed");
      // The rejected start left no native turn, so the session is idle again.
      expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.activity).toBe("idle");
      await flushCodexAdapterWork();
      expect(
        events.filter((event) => event.type === "user_message" || event.type === "session_error"),
      ).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("a send reports acceptance when its owner is released during turn/start", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const send = adapter.sendUserMessage(
      codexUserMessageInput({ parts: [{ kind: "text", text: "Kickoff" }] }),
    );
    await transport.turnStartRequested.promise;
    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      transport.completeTurnStart();
      let failure: CodexMessageAcceptedError | null = null;
      try {
        await send;
      } catch (cause) {
        if (cause instanceof CodexMessageAcceptedError) failure = cause;
      }
      // Codex started the turn with the input, so the message must not be offered for Retry.
      expect(failure?.acceptedMessage.message).toBe("Kickoff");
      await flushCodexAdapterWork();
      expect(replacementEvents).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("a send waits for the Codex answer after its owner is released", async () => {
    const transport = new RejectableTurnTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    let settled = false;
    const send = adapter
      .sendUserMessage(codexUserMessageInput({ parts: [{ kind: "text", text: "Kickoff" }] }))
      .finally(() => {
        settled = true;
      });
    await flushCodexAdapterWork();
    adapter.releaseRuntime("runtime-live");
    await flushCodexAdapterWork();
    // A released owner does not turn the pending request into a local receipt.
    expect(settled).toBe(false);
    transport.failTurnStart(new AgentSessionMessageRefusedError(new Error("turn rejected")));
    let failure: Error | null = null;
    try {
      await send;
    } catch (cause) {
      if (cause instanceof Error) failure = cause;
    }
    expect(failure?.message).toContain("turn rejected");
    expect(failure).not.toBeInstanceOf(CodexMessageAcceptedError);
  });

  test("keeps an admitted steer accepted after its retained owner is released", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const firstSend = adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "first" }],
      }),
    );
    await transport.turnStartRequested.promise;
    transport.completeTurnStart();
    await firstSend;
    await flushCodexAdapterWork();

    const oldSend = adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "second" }],
        delivery: "steer",
      }),
    );
    await transport.steerRequested.promise;
    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());

    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      transport.completeSteer();
      let failure: CodexMessageAcceptedError | null = null;
      try {
        await oldSend;
      } catch (cause) {
        if (cause instanceof CodexMessageAcceptedError) failure = cause;
      }
      // Codex admitted the steer, so the caller must not send it again.
      expect(failure?.acceptedMessage.message).toBe("second");
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("a steer calls onSent only when it sends turn/steer", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const firstSend = adapter.sendUserMessage(
      codexUserMessageInput({ parts: [{ kind: "text", text: "first" }] }),
    );
    await transport.turnStartRequested.promise;
    let sent = false;
    const send = adapter.sendUserMessage(
      codexUserMessageInput({ parts: [{ kind: "text", text: "second" }], delivery: "steer" }),
      {
        onSent: () => {
          sent = true;
        },
      },
    );
    await flushCodexAdapterWork();
    // The steer waits for the first turn, so Codex has not received the message yet.
    expect(sent).toBe(false);
    transport.completeTurnStart();
    await firstSend;
    await transport.steerRequested.promise;
    expect(sent).toBe(true);
    transport.completeSteer();
    await expect(send).resolves.toMatchObject({ message: "second" });
  });

  test("a steer that waits on a rejected turn does not call onSent", async () => {
    const transport = new RejectableTurnTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const firstSend = failureOf(
      adapter.sendUserMessage(codexUserMessageInput({ parts: [{ kind: "text", text: "first" }] })),
    );
    let sent = false;
    const send = failureOf(
      adapter.sendUserMessage(
        codexUserMessageInput({ parts: [{ kind: "text", text: "second" }], delivery: "steer" }),
        {
          onSent: () => {
            sent = true;
          },
        },
      ),
    );
    await flushCodexAdapterWork();
    transport.failTurnStart(new AgentSessionMessageRefusedError(new Error("first turn rejected")));
    expect(await firstSend).toBeInstanceOf(Error);
    expect(await send).toBeInstanceOf(Error);
    expect(sent).toBe(false);
  });

  test("waits for turn admission before a steer and reports its late failure only to the caller", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const firstSend = adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "first" }],
      }),
    );
    await transport.turnStartRequested.promise;
    const steer = adapter
      .sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "steer" }],
          delivery: "steer",
        }),
      )
      .then(
        () => null,
        (error: Error) => error,
      );
    expect(transport.calls.filter((call) => call.method === "turn/steer")).toEqual([]);
    transport.completeTurnStart();
    await firstSend;
    await transport.steerRequested.promise;

    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      transport.failSteer(new Error("old steer failed"));
      expect(await steer).toBeInstanceOf(Error);
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("refuses a new turn while the current turn runs", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    const firstSend = adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "first" }],
      }),
    );
    await transport.turnStartRequested.promise;

    const failure = await adapter
      .sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "next turn" }],
        }),
      )
      .then(
        () => null,
        (error: Error) => error,
      );

    expect(failure).toBeInstanceOf(AgentSessionTurnActiveError);
    expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(1);
    expect(transport.calls.filter((call) => call.method === "turn/steer")).toEqual([]);
    transport.completeTurnStart();
    await firstSend;
  });

  test("drops queued runtime events from a released runtime generation", async () => {
    const mutationStarted = createDeferred<void>();
    const allowMutation = createDeferred<void>();
    const { subscribeEvents, emitNotification, captureLatestSubscription, subscriptionCount } =
      createRuntimeStreamSubscription();
    let mutationCount = 0;
    const { adapter } = createHarness({
      subscribeEvents,
      onLiveSessionMutation: async () => {
        mutationCount += 1;
        if (mutationCount === 1) {
          mutationStarted.resolve();
          await allowMutation.promise;
        }
      },
    });

    await adapter.startSession(codexStartSessionInput());
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "active", activeFlags: [] },
      },
    });
    await mutationStarted.promise;
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });

    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    expect(subscriptionCount()).toBe(2);
    const replacementSubscription = captureLatestSubscription();
    replacementSubscription.emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "active", activeFlags: [] },
      },
    });

    try {
      await flushCodexAdapterWork();
      expect(mutationCount).toBe(2);
      await expect(
        adapter.readSessionRuntimeSnapshot({
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: "thread/start-runtime-live",
        }),
      ).resolves.toMatchObject({ availability: "runtime", classification: "running" });
    } finally {
      allowMutation.resolve();
      await flushCodexAdapterWork();
    }

    expect(mutationCount).toBe(2);
  });
});

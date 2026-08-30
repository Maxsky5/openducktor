import { describe, expect, test } from "bun:test";
import type {
  CodexAppServerTurnStartResult,
  CodexAppServerTurnSteerResult,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
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
import { releaseCodexRuntimeState } from "./codex-runtime-cleanup";
import type { CodexAppServerClient, CodexLiveSessionMutation } from "./types";

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
    const { adapter, transports } = createHarness({}, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "Complete after release" }],
      }),
    );
    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());

    const transport = transports.get("runtime-live");
    if (!transport) {
      throw new Error("Expected the runtime transport to retain the deferred turn.");
    }
    transport.turnStartDeferred.resolve({
      turn: codexTurnFixture({ id: "turn-late", items: [], status: "completed" }),
    });
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

    await expect(send).rejects.toThrow(
      "Cannot continue Codex turn for session 'thread/start-runtime-live' because its retained owner was released or replaced.",
    );
  });

  test("does not send a turn after ownership is lost during model validation", async () => {
    const { adapter, transports } = createHarness();
    const internals: {
      models: {
        validate: (
          client: CodexAppServerClient,
          runtimeId: string,
          model: { providerId: string; modelId: string; variant: string },
        ) => Promise<void>;
      };
    } = adapter;
    const validationStarted = createDeferred<void>();
    const allowValidation = createDeferred<void>();

    await adapter.startSession(codexStartSessionInput());
    const validateModel = internals.models.validate;
    internals.models.validate = async () => {
      validationStarted.resolve();
      await allowValidation.promise;
    };
    try {
      const send = adapter.sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "Release during validation" }],
        }),
      );
      await validationStarted.promise;
      adapter.releaseRuntime("runtime-live");
      allowValidation.resolve();

      await expect(send).rejects.toThrow(
        "Cannot continue Codex turn for session 'thread/start-runtime-live' because its retained owner was released or replaced.",
      );
      const transport = transports.get("runtime-live");
      if (!transport) {
        throw new Error("Expected the runtime transport used during model validation.");
      }
      expect(transport.calls.filter((request) => request.method === "turn/start")).toEqual([]);
    } finally {
      internals.models.validate = validateModel;
    }
  });

  test("does not report a released turn failure to a replacement session", async () => {
    const transport = new RejectableTurnTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "Fail after release" }],
      }),
    );
    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());

    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      transport.failTurnStart(new Error("old turn failed"));
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

  test("reports a rejected turn to its current retained session", async () => {
    const transport = new RejectableTurnTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "Fail while retained" }],
      }),
    );

    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    try {
      transport.failTurnStart(new Error("current turn failed"));
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_error",
          externalSessionId: "thread/start-runtime-live",
          message: "current turn failed",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("rejects a known-turn steer after its retained owner is released", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "first" }],
      }),
    );
    await transport.turnStartRequested.promise;
    transport.completeTurnStart();
    await flushCodexAdapterWork();

    const oldSend = adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "second" }],
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
      await expect(oldSend).rejects.toThrow(
        "Cannot continue Codex turn for session 'thread/start-runtime-live' because its retained owner was released or replaced.",
      );
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("does not report a late queued-steer failure to a replacement session", async () => {
    const transport = new DeferredSteerTransport();
    const adapter = createAdapterWithTransport(transport);

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "first" }],
      }),
    );
    await transport.turnStartRequested.promise;
    await adapter.sendUserMessage(
      codexUserMessageInput({
        parts: [{ kind: "text", text: "queued" }],
      }),
    );
    transport.completeTurnStart();
    await transport.steerRequested.promise;

    adapter.releaseRuntime("runtime-live");
    await adapter.startSession(codexStartSessionInput());
    const replacementEvents: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => replacementEvents.push(event),
    );
    try {
      transport.failSteer(new Error("old queued steer failed"));
      await flushCodexAdapterWork();

      expect(replacementEvents).toEqual([]);
    } finally {
      unsubscribe();
    }
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

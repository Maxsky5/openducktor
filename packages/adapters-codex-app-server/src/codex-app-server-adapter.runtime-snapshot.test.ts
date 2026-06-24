import { describe, expect, mock, test } from "bun:test";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  createDeferred,
  createHarness,
  flushCodexAdapterWork,
  RecordingTransport,
  waitForEvent,
} from "./codex-app-server-adapter.test-harness";
import type { CodexAppServerAdapter, CodexJsonRpcRequest } from "./index";

class ThreadIdOnlyResumeTransport extends RecordingTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/resume") {
      return {
        threadId: (request.params as { threadId: string }).threadId,
        startedAt: "2026-05-07T00:00:00.000Z",
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class DeferredInventoryTransport extends RecordingTransport {
  readonly loadedList = createDeferred<unknown>();
  readonly threadList = createDeferred<unknown>();

  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/loaded/list") {
      this.calls.push(request);
      return this.loadedList.promise as Promise<Response>;
    }
    if (request.method === "thread/list") {
      this.calls.push(request);
      return this.threadList.promise as Promise<Response>;
    }
    return super.request<Response>(request);
  }
}

class MutableThreadListTransport extends RecordingTransport {
  threadSavedStatus: Record<string, unknown> = { type: "active", activeFlags: [] };

  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/list") {
      this.calls.push(request);
      return {
        data: [
          {
            id: "thread-saved",
            cwd: "/repo",
            createdAt: 1_778_112_000,
            preview: "Saved session",
            status: this.threadSavedStatus,
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class IdleThreadResumeActiveListTransport extends MutableThreadListTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/resume") {
      this.calls.push(request);
      return {
        thread: {
          id: (request.params as { threadId: string }).threadId,
          cwd: "/repo",
          createdAt: 1_778_112_000,
          preview: "Saved session",
          status: { type: "idle" },
          turns: [],
        },
        startedAt: "2026-05-07T00:00:00.000Z",
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class StoredIdleHistoryTransport extends RecordingTransport {
  includeThread = true;
  loaded = false;
  threadStatus: Record<string, unknown> = { type: "idle" };

  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/loaded/list") {
      this.calls.push(request);
      return {
        data: this.loaded ? ["thread-idle"] : [],
        nextCursor: null,
      } as Response;
    }
    if (request.method === "thread/list") {
      this.calls.push(request);
      return {
        data: this.includeThread
          ? [
              {
                id: "thread-idle",
                cwd: "/repo",
                createdAt: 1_778_112_010,
                preview: "Saved idle session",
                status: this.threadStatus,
              },
            ]
          : [],
        nextCursor: null,
        backwardsCursor: null,
      } as Response;
    }
    if (request.method === "thread/read") {
      this.calls.push(request);
      return {
        thread: {
          id: "thread-idle",
          cwd: "/repo",
          createdAt: 1_778_112_010,
          preview: "Saved idle session",
          status: { type: "idle" },
          turns: [
            {
              id: "turn-1",
              status: "completed",
              items: [
                {
                  id: "msg-1",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "Done",
                },
              ],
            },
          ],
        },
      } as Response;
    }
    if (request.method === "thread/turns/list") {
      this.calls.push(request);
      return { data: [], nextCursor: null } as Response;
    }
    if (request.method === "thread/resume") {
      this.calls.push(request);
      this.loaded = true;
      return {
        thread: {
          id: "thread-idle",
          cwd: "/repo",
          createdAt: 1_778_112_010,
          preview: "Saved idle session",
          status: { type: "idle" },
          turns: [],
        },
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class RestoredUsageStreamTransport extends StoredIdleHistoryTransport {
  emitRestoredUsage: ((message: unknown) => void) | null = null;

  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/resume") {
      const response = await super.request<Response>(request);
      setTimeout(() => {
        this.emitRestoredUsage?.({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-idle",
            turnId: "turn-1",
            tokenUsage: {
              total: { totalTokens: 42_000 },
              last: { totalTokens: 1_000 },
              modelContextWindow: 200_000,
            },
          },
        });
      }, 0);
      return response;
    }
    return super.request<Response>(request);
  }
}

const localSessions = (
  adapter: CodexAppServerAdapter,
): { has(externalSessionId: string): boolean } =>
  (adapter as unknown as { localSessions: { has(externalSessionId: string): boolean } })
    .localSessions;

const observeSessionState = async (
  adapter: CodexAppServerAdapter,
  externalSessionId: string,
): Promise<void> => {
  await adapter.subscribeEvents(codexSessionRuntimeRef(externalSessionId), () => {});
  await flushCodexAdapterWork();
};

const waitForTransportCall = async (
  transport: RecordingTransport,
  predicate: (request: CodexJsonRpcRequest) => boolean,
): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (transport.calls.some(predicate)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Codex transport call.");
};

describe("CodexAppServerAdapter runtime snapshots", () => {
  test("coalesces concurrent Codex runtime snapshot inventory scans", async () => {
    const transport = new DeferredInventoryTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    const firstRuntimeSnapshotRead = adapter.listSessionRuntimeSnapshots({
      repoPath: "/repo",
      runtimeKind: "codex",
      directories: ["/repo"],
    });
    const secondRuntimeSnapshotRead = adapter.listSessionRuntimeSnapshots({
      repoPath: "/repo",
      runtimeKind: "codex",
      directories: ["/repo"],
    });
    await flushCodexAdapterWork();

    expect(transport.calls.filter((call) => call.method === "thread/loaded/list")).toHaveLength(1);
    expect(transport.calls.filter((call) => call.method === "thread/list")).toHaveLength(1);

    transport.loadedList.resolve({ data: ["thread-saved"], nextCursor: null });
    transport.threadList.resolve({
      data: [
        {
          id: "thread-saved",
          cwd: "/repo",
          createdAt: 1_778_112_000,
          preview: "Saved running session",
          status: { type: "active", activeFlags: [] },
        },
      ],
      nextCursor: null,
      backwardsCursor: null,
    });

    await expect(
      Promise.all([firstRuntimeSnapshotRead, secondRuntimeSnapshotRead]),
    ).resolves.toEqual([
      [
        expect.objectContaining({
          ref: expect.objectContaining({ externalSessionId: "thread-saved" }),
        }),
      ],
      [
        expect.objectContaining({
          ref: expect.objectContaining({ externalSessionId: "thread-saved" }),
        }),
      ],
    ]);
    expect(transport.calls.filter((call) => call.method === "thread/loaded/list")).toHaveLength(1);
    expect(transport.calls.filter((call) => call.method === "thread/list")).toHaveLength(1);
  });

  test("refreshes Codex thread inventory during runtime snapshot reads", async () => {
    const { adapter, transports } = createHarness();

    await expect(
      adapter.listSessionRuntimeSnapshots({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-saved" }),
      }),
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    ]);
    await expect(
      adapter.listSessionRuntimeSnapshots({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-saved" }),
      }),
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    ]);

    const transport = transports.get("runtime-live");
    expect(transport?.calls.filter((call) => call.method === "thread/loaded/list")).toHaveLength(2);
    expect(transport?.calls.filter((call) => call.method === "thread/list")).toHaveLength(2);
    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        availability: "runtime",
        ref: expect.objectContaining({ externalSessionId: "thread-saved" }),
      }),
    );
    expect(transport?.calls.filter((call) => call.method === "thread/read")).toHaveLength(0);
    expect(transport?.calls.filter((call) => call.method === "thread/loaded/list")).toHaveLength(3);
    expect(transport?.calls.filter((call) => call.method === "thread/list")).toHaveLength(3);
  });

  test("refreshes a known Codex session from runtime thread status", async () => {
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await observeSessionState(adapter, "thread-saved");

    transport.threadSavedStatus = { type: "idle" };

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      classification: "idle",
    });
  });

  test("detects live Codex sessions from App Server after adapter refresh", async () => {
    const { adapter, transports } = createHarness();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      classification: "running",
      ref: expect.objectContaining({
        externalSessionId: "thread-saved",
        workingDirectory: "/repo",
      }),
    });

    expect(localSessions(adapter).has("thread-saved")).toBe(false);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toContain(
      "thread/loaded/list",
    );
  });

  test("keeps background Codex context restore presence idle", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    expect(transport.calls.some((call) => call.method === "thread/read")).toBe(true);
    await flushCodexAdapterWork();
    await waitForTransportCall(
      transport,
      (call) =>
        call.method === "thread/resume" &&
        (call.params as { threadId?: unknown; excludeTurns?: unknown }).threadId ===
          "thread-idle" &&
        (call.params as { threadId?: unknown; excludeTurns?: unknown }).excludeTurns === false,
    );

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      classification: "idle",
    });
    await expect(
      adapter.listSessionRuntimeSnapshots({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        availability: "runtime",
        classification: "idle",
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    ]);
    expect(localSessions(adapter).has("thread-idle")).toBe(false);
  });

  test("keeps real pending input visible after a Codex idle history load", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    await flushCodexAdapterWork();
    expect(transport.calls).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({
          threadId: "thread-idle",
          excludeTurns: false,
        }),
      }),
    );
    transport.loaded = true;
    transport.threadStatus = { type: "active", activeFlags: ["waitingOnUserInput"] };

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      classification: "waiting_for_question",
    });
  });

  test("does not let background Codex context restore status mark a loaded idle session running", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    let didDrainHistoryResumeNotifications = false;
    const drainNotifications = mock(async () => {
      const didResumeForHistory = transport.calls.some(
        (call) =>
          call.method === "thread/resume" &&
          (call.params as { threadId?: string }).threadId === "thread-idle" &&
          (call.params as { excludeTurns?: boolean }).excludeTurns === false,
      );
      if (!didResumeForHistory || didDrainHistoryResumeNotifications) {
        return [];
      }
      didDrainHistoryResumeNotifications = true;
      return [
        {
          method: "thread/status/changed",
          params: {
            threadId: "thread-idle",
            status: { type: "active", activeFlags: [] },
          },
        },
        {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-idle",
            turnId: "turn-1",
            tokenUsage: {
              total: { totalTokens: 42_000 },
              last: { totalTokens: 1_000 },
              modelContextWindow: 200_000,
            },
          },
        },
      ];
    });
    const { adapter } = createHarness({
      drainNotifications,
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    await flushCodexAdapterWork();

    expect(transport.calls).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({
          threadId: "thread-idle",
          excludeTurns: false,
        }),
      }),
    );
    expect(localSessions(adapter).has("thread-idle")).toBe(false);

    await adapter.subscribeEvents(codexSessionRuntimeRef("thread-idle"), () => {});
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
  });

  test("buffers restored idle history context usage emitted before the session is observed", async () => {
    const transport = new RestoredUsageStreamTransport("runtime-live", false);
    const subscribeEvents = mock(async (runtimeId: string, listener) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      transport.emitRestoredUsage = (message) =>
        listener({ runtimeId, kind: "notification", message });
      return () => {};
    });
    const { adapter } = createHarness({
      drainNotifications: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    await flushCodexAdapterWork();

    expect(subscribeEvents).toHaveBeenCalled();
    await waitForTransportCall(
      transport,
      (call) =>
        call.method === "thread/resume" &&
        (call.params as { threadId?: unknown; excludeTurns?: unknown }).threadId ===
          "thread-idle" &&
        (call.params as { threadId?: unknown; excludeTurns?: unknown }).excludeTurns === false,
    );

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-idle"),
      (event) => events.push(event),
    );
    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; totalTokens?: unknown }).type === "session_context_updated" &&
        (event as { totalTokens?: unknown }).totalTokens === 1_000,
    );
    unsubscribe();
  });

  test("subscribes to a stored Codex session without resuming it", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    const subscribeEvents = mock((_runtimeId: string, _listener) => () => {});
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    const unsubscribe = await adapter.subscribeEvents(codexSessionRef("thread-idle"), () => {});
    unsubscribe();

    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(false);
  });

  test("lists loaded Codex sessions from App Server", async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.listSessionRuntimeSnapshots({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      {
        availability: "runtime",
        classification: "running",
        ref: {
          externalSessionId: "thread-saved",
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
        },
        title: "Saved running session",
        startedAt: "2026-05-07T00:00:00.000Z",
        pendingApprovals: [],
        pendingQuestions: [],
      },
      {
        availability: "runtime",
        classification: "idle",
        ref: {
          externalSessionId: "thread-idle",
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
        },
        title: "Saved idle session",
        startedAt: "2026-05-07T00:00:10.000Z",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    ]);
  });

  test("reports a newly started local session while loaded-thread inventory catches up", async () => {
    const { adapter } = createHarness();

    const summary = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: summary.externalSessionId,
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      title: "BUILD task-1",
      ref: expect.objectContaining({ externalSessionId: summary.externalSessionId }),
    });
  });

  test("prepares a missing live Codex session without starting a turn", async () => {
    const { adapter, transports } = createHarness();

    await observeSessionState(adapter, "thread-saved");

    expect(localSessions(adapter).has("thread-saved")).toBe(true);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toContain(
      "thread/resume",
    );
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).not.toContain(
      "turn/start",
    );
  });

  test("trusts active inventory over an idle thread/resume response during reload", async () => {
    const transport = new IdleThreadResumeActiveListTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await observeSessionState(adapter, "thread-saved");

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({
      classification: "running",
    });
  });

  test("prepares an idle Codex thread without marking it running", async () => {
    const { adapter } = createHarness();

    await observeSessionState(adapter, "thread-idle");

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
  });

  test("resumes an idle Codex thread without marking it running", async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        taskId: "task-1",
        role: "build",
        systemPrompt: "Use the repo rules.",
        externalSessionId: "thread-idle",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).resolves.toMatchObject({
      externalSessionId: "thread-idle",
      status: "idle",
    });

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
  });

  test("rejects Codex resume responses without a thread status", async () => {
    const transport = new ThreadIdOnlyResumeTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });
    const expectedMessage =
      "Codex thread/resume response for thread 'thread-idle' is missing thread status.";

    await expect(
      adapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        taskId: "task-1",
        role: "build",
        systemPrompt: "Use the repo rules.",
        externalSessionId: "thread-idle",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).rejects.toThrow(expectedMessage);

    expect(localSessions(adapter).has("thread-idle")).toBe(false);
  });

  test("streams messages and completion after refresh session preparation", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainNotifications = mock(async () => [] as unknown[]);
    const drainServerRequests = mock(async () => [] as unknown[]);
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      drainNotifications,
      drainServerRequests,
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await observeSessionState(adapter, "thread-saved");

    const notifications = [
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          itemId: "agent-live",
          delta: "new streamed text",
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          item: { id: "agent-live", type: "agentMessage", text: "new streamed text" },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thread-saved",
          turn: { id: "turn-live", status: "completed" },
        },
      },
    ];

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );
    for (const message of notifications) {
      streamListeners[0]?.({ runtimeId: "runtime-live", kind: "notification", message });
    }
    transport.threadSavedStatus = { type: "idle" };

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; delta?: unknown }).type === "assistant_delta" &&
        (event as { delta?: unknown }).delta === "new streamed text",
    );
    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "session_idle",
    );

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
    expect(drainNotifications).not.toHaveBeenCalled();
    expect(drainServerRequests).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("does not resurrect an idle local session from stale active thread inventory", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      drainNotifications: mock(async () => [] as unknown[]),
      drainServerRequests: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await observeSessionState(adapter, "thread-saved");

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "turn/completed",
        params: {
          threadId: "thread-saved",
          turn: { id: "turn-live", status: "completed" },
        },
      },
    });

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "session_idle",
    );
    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
    unsubscribe();
  });

  test("clears live status overrides when releasing a Codex session", async () => {
    const subscribeEvents = mock((_runtimeId: string, _listener) => () => {});
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      drainNotifications: mock(async () => [] as unknown[]),
      drainServerRequests: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await observeSessionState(adapter, "thread-saved");
    await adapter.sendUserMessage({
      ...codexSessionRuntimeRef("thread-saved"),
      parts: [{ kind: "text", text: "Continue" }],
    });
    transport.threadSavedStatus = { type: "idle" };

    await adapter.releaseSession({
      externalSessionId: "thread-saved",
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
    });

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
  });

  test("streams messages and completion after refresh resume stream", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainNotifications = mock(async () => [] as unknown[]);
    const drainServerRequests = mock(async () => [] as unknown[]);
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      drainNotifications,
      drainServerRequests,
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      externalSessionId: "thread-saved",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "turn/completed",
        params: {
          threadId: "thread-saved",
          turn: { id: "turn-live", status: "completed" },
        },
      },
    });
    transport.threadSavedStatus = { type: "idle" };

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "session_idle",
    );
    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
    expect(drainNotifications).not.toHaveBeenCalled();
    expect(drainServerRequests).not.toHaveBeenCalled();
    unsubscribe();
  });
});

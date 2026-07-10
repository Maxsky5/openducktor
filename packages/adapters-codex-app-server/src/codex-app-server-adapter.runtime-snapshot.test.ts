import { describe, expect, mock, test } from "bun:test";
import {
  bufferedNotificationEvent,
  codexSessionRef,
  codexSessionRuntimeRef,
  codexUserMessageInput,
  createDeferred,
  createHarness,
  defaultCodexEffectivePolicy,
  flushCodexAdapterWork,
  RecordingTransport,
  waitForEvent,
} from "./codex-app-server-adapter.test-harness";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexAppServerAdapter, CodexJsonRpcRequest } from "./index";

const runtimeEventReceivedAt = "2026-07-06T12:00:00.000Z";

type RuntimeEventInput = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
};

type RuntimeListener = (event: RuntimeEventInput) => void;

const withRuntimeReceivedAt = (event: RuntimeEventInput) => ({
  ...event,
  receivedAt: runtimeEventReceivedAt,
});

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

class ChildThreadListTransport extends RecordingTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/list") {
      this.calls.push(request);
      return {
        data: [
          {
            id: "child-thread",
            cwd: "/repo",
            createdAt: 1_778_112_020,
            preview: "Child subagent",
            status: { type: "idle" },
            parentThreadId: "parent-thread",
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class ParentWithChildThreadListTransport extends RecordingTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/list") {
      this.calls.push(request);
      return {
        data: [
          {
            id: "parent-thread",
            cwd: "/repo",
            createdAt: 1_778_112_000,
            preview: "Parent session",
            status: { type: "active", activeFlags: [] },
          },
          {
            id: "child-thread",
            cwd: "/repo",
            createdAt: 1_778_112_020,
            preview: "Child subagent",
            status: { type: "active", activeFlags: [] },
            parentThreadId: "parent-thread",
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class IdleParentThreadListTransport extends RecordingTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/list") {
      this.calls.push(request);
      return {
        data: [
          {
            id: "parent-thread",
            cwd: "/repo",
            createdAt: 1_778_112_000,
            preview: "Idle parent session",
            status: { type: "idle" },
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
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
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
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    await flushCodexAdapterWork();
    await waitForTransportCall(
      transport,
      (call) =>
        call.method === "thread/resume" &&
        (call.params as { threadId?: unknown; excludeTurns?: unknown }).threadId ===
          "thread-idle" &&
        (call.params as { threadId?: unknown; excludeTurns?: unknown }).excludeTurns === false,
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
    const takeBufferedEvents = mock(async () => {
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
        bufferedNotificationEvent({
          method: "thread/status/changed",
          params: {
            threadId: "thread-idle",
            status: { type: "active", activeFlags: [] },
          },
        }),
        bufferedNotificationEvent({
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
        }),
      ];
    });
    const { adapter } = createHarness({
      takeBufferedEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
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
        listener(withRuntimeReceivedAt({ runtimeId, kind: "notification", message }));
      return () => {};
    });
    const { adapter } = createHarness({
      takeBufferedEvents: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
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

  test("resumes a stored main session before sending after an idle event subscription", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    const subscribeEvents = mock((_runtimeId: string, _listener) => () => {});
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    const unsubscribe = await adapter.subscribeEvents(codexSessionRef("thread-idle"), () => {});
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread-idle",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        parts: [{ kind: "text", text: "Continue" }],
      }),
    );
    unsubscribe();

    const resumeIndex = transport.calls.findIndex((call) => call.method === "thread/resume");
    const turnStartIndex = transport.calls.findIndex((call) => call.method === "turn/start");
    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(turnStartIndex).toBeGreaterThanOrEqual(0);
    expect(resumeIndex).toBeLessThan(turnStartIndex);
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
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
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
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
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
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        externalSessionId: "thread-idle",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).rejects.toThrow(expectedMessage);

    expect(localSessions(adapter).has("thread-idle")).toBe(false);
  });

  test("streams messages and completion after refresh session preparation", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      takeBufferedEvents,
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
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("streams child transcript events after read-only subscription materializes inventory thread", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const transport = new ChildThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      takeBufferedEvents: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("child-thread"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "child-thread",
          turnId: "turn-live",
          itemId: "agent-live",
          delta: "new child text",
        },
      },
    });

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; delta?: unknown }).type === "assistant_delta" &&
        (event as { delta?: unknown }).delta === "new child text",
    );
    expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(false);
    unsubscribe();
  });

  test("streams child transcript events for a learned subagent route absent from inventory", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      takeBufferedEvents: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    const parentEvents: unknown[] = [];
    const unsubscribeParent = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => parentEvents.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "item/completed",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          completedAtMs: 1_777_766_452_000,
          item: {
            type: "collabAgentToolCall",
            id: "spawn-live",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "thread-saved",
            receiverThreadIds: ["child-thread"],
            prompt: "Inspect child work",
            agentsStates: {
              "child-thread": { status: "running", message: null },
            },
          },
        },
      },
    });
    await waitForEvent(
      parentEvents,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "assistant_part" &&
        (event as { part?: { kind?: unknown; externalSessionId?: unknown } }).part?.kind ===
          "subagent" &&
        (event as { part?: { externalSessionId?: unknown } }).part?.externalSessionId ===
          "child-thread",
    );

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("child-thread"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "child-thread",
          turnId: "turn-live",
          itemId: "agent-live",
          delta: "child route text",
        },
      },
    });

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; delta?: unknown }).type === "assistant_delta" &&
        (event as { delta?: unknown }).delta === "child route text",
    );
    expect(transport.calls).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({ threadId: "child-thread" }),
      }),
    );

    const history = await adapter.loadSessionHistory(codexSessionRuntimeRef("child-thread"));
    expect(transport.calls.map((call) => call.method)).toContain("thread/read");
    expect(history.map((message) => message.messageId)).toContain("msg-1");

    unsubscribe();
    unsubscribeParent();
  });

  test("routes child server requests through routes learned from refreshed inventory", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const transport = new ParentWithChildThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      takeBufferedEvents: mock(async () => [] as unknown[]),
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("parent-thread"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 64,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; externalSessionId?: unknown }).type === "question_required" &&
        (event as { externalSessionId?: unknown }).externalSessionId === "parent-thread" &&
        (event as { childExternalSessionId?: unknown }).childExternalSessionId === "child-thread",
    );
    unsubscribe();
  });

  test("replays mirrored pending input when subscribing an idle parent without a local session", async () => {
    const { adapter } = createHarness({
      transportFactory: mock(() => new IdleParentThreadListTransport("runtime-live", false)),
    });
    const adapterState = adapter as unknown as { pendingInput: CodexPendingInputState };
    adapterState.pendingInput.addQuestion({
      runtimeId: "runtime-live",
      threadId: "child-thread",
      request: {
        requestId: "question-1",
        questions: [
          {
            id: "question-item-1",
            header: "Choose",
            question: "Proceed?",
            options: ["Yes", "No"],
          },
        ],
      },
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
      route: {
        runtimeId: "runtime-live",
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
        subagentCorrelationKey: "codex-subagent:parent-thread:spawn-1",
      },
    });
    const events: unknown[] = [];

    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("parent-thread"),
      (event) => events.push(event),
    );

    try {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "question_required",
          externalSessionId: "parent-thread",
          childExternalSessionId: "child-thread",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("does not resurrect an idle local session from stale active thread inventory", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      takeBufferedEvents: mock(async () => [] as unknown[]),
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
      takeBufferedEvents: mock(async () => [] as unknown[]),
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
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const transport = new MutableThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      takeBufferedEvents,
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
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
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    unsubscribe();
  });
});

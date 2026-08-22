import { hasRuntimeType } from "@openducktor/contracts";
import { describe, expect, mock, test } from "bun:test";
import type { CodexAppServerThreadStatus, JsonValue } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY } from "@openducktor/core";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexThreadFixture,
  codexThreadStartResultFixture,
  codexTurnFixture,
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
      // SAFETY: This test controls the fixture and supplies the asserted shape used by this case.
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
      // SAFETY: This test controls the fixture and supplies `Promise<Response>` used by this case.
      return this.loadedList.promise as Promise<Response>;
    }
    if (request.method === "thread/list") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Promise<Response>` used by this case.
      return this.threadList.promise as Promise<Response>;
    }
    return super.request<Response>(request);
  }
}

class MutableThreadListTransport extends RecordingTransport {
  threadSavedStatus: CodexAppServerThreadStatus = { type: "active", activeFlags: [] };

  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/list") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        data: [codexThreadFixture({ id: "thread-saved", status: this.threadSavedStatus })],
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
      // SAFETY: This test controls the fixture and supplies `{ sourceKinds?: unknown }` used by this case.
      const sourceKinds = (request.params as { sourceKinds?: unknown }).sourceKinds;
      const includesSubagents = Array.isArray(sourceKinds) && sourceKinds.includes("subAgent");
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        data: includesSubagents
          ? [
              codexThreadFixture({
                id: "child-thread",
                status: { type: "idle" },
                parentThreadId: "parent-thread",
              }),
            ]
          : [],
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
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        data: [codexThreadFixture({ id: "parent-thread", status: { type: "idle" } })],
        nextCursor: null,
        backwardsCursor: null,
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class IdleParentWithActiveChildTransport extends RecordingTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/list") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        data: [
          codexThreadFixture({ id: "parent-thread", status: { type: "idle" } }),
          codexThreadFixture({
            id: "child-thread",
            status: { type: "active", activeFlags: [] },
            parentThreadId: "parent-thread",
          }),
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
      // SAFETY: This test controls the fixture and supplies `{ threadId: string }` used by this case.
      const threadId = (request.params as { threadId: string }).threadId;
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        ...codexThreadStartResultFixture(threadId),
        thread: codexThreadFixture({ id: threadId, status: { type: "idle" } }),
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class StoredIdleHistoryTransport extends RecordingTransport {
  includeThread = true;
  loaded = false;
  threadStatus: CodexAppServerThreadStatus = { type: "idle" };

  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/loaded/list") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        data: this.loaded ? ["thread-idle"] : [],
        nextCursor: null,
      } as Response;
    }
    if (request.method === "thread/list") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        data: this.includeThread
          ? [codexThreadFixture({ id: "thread-idle", status: this.threadStatus })]
          : [],
        nextCursor: null,
        backwardsCursor: null,
      } as Response;
    }
    if (request.method === "thread/read") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        thread: codexThreadFixture({
          id: "thread-idle",
          status: { type: "idle" },
          turns: [
            codexTurnFixture({
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
            }),
          ],
        }),
      } as Response;
    }
    if (request.method === "thread/turns/list") {
      this.calls.push(request);
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return { data: [], nextCursor: null, backwardsCursor: null } as Response;
    }
    if (request.method === "thread/resume") {
      this.calls.push(request);
      this.loaded = true;
      // SAFETY: This test controls the fixture and supplies `Response` used by this case.
      return {
        ...codexThreadStartResultFixture("thread-idle"),
        thread: codexThreadFixture({ id: "thread-idle", status: { type: "idle" } }),
      } as Response;
    }
    return super.request<Response>(request);
  }
}

class RestoredUsageStreamTransport extends StoredIdleHistoryTransport {
  emitRestoredUsage: ((message: JsonValue | undefined) => void) | null = null;

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
              last: { totalTokens: 42_000 },
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

// SAFETY: This test controls the fixture and supplies `{ localSessions: { has(externalSessionId: string): boolean } }` used by this case.
const localSessions = (
  adapter: CodexAppServerAdapter,
): { has(externalSessionId: string): boolean } =>
  (adapter as { localSessions: { has(externalSessionId: string): boolean } }).localSessions;

const observeSessionState = async (
  adapter: CodexAppServerAdapter,
  externalSessionId: string,
): Promise<void> => {
  await adapter.subscribeEvents(codexSessionRuntimeRef(externalSessionId), () => {});
  await flushCodexAdapterWork();
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
        codexThreadFixture({
          id: "thread-saved",
          status: { type: "active", activeFlags: [] },
        }),
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

  test("retains an idle live session after a successful null context resume", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    const subscribeEvents = mock((_runtimeId: string, _listener) => () => undefined);
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.prepareRuntime("runtime-live");
    await expect(
      adapter.loadSessionContextUsage({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toBeNull();
    expect(transport.calls).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({ threadId: "thread-idle", excludeTurns: false }),
      }),
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
    expect(localSessions(adapter).has("thread-idle")).toBe(true);
  });

  test("keeps real pending input visible after a Codex idle history load", async () => {
    const transport = new StoredIdleHistoryTransport("runtime-live", false);
    let streamListener: RuntimeListener | null = null;
    const subscribeEvents = mock((runtimeId: string, listener) => {
      streamListener = (event) => listener(withRuntimeReceivedAt({ ...event, runtimeId }));
      return () => undefined;
    });
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: mock(() => transport),
    });
    transport.loaded = true;
    transport.threadStatus = { type: "active", activeFlags: ["waitingOnUserInput"] };
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread-idle"), (event) =>
      events.push(event),
    );
    streamListener?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: "idle-question",
        method: "item/tool/requestUserInput",
        params: {
          autoResolutionMs: null,
          isBlocking: true,
          itemId: "idle-question-item",
          threadId: "thread-idle",
          turnId: "turn-idle",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      },
    });
    // SAFETY: This test controls the fixture and supplies `{ type?: unknown }` used by this case.
    const question = await waitForEvent(
      events,
      (event) =>
        hasRuntimeType(event, "object") &&
        event !== null &&
        (event as { type?: unknown }).type === "question_required",
    );

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });

    // SAFETY: This test controls the fixture and supplies `{ requestId: string }` used by this case.
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
      pendingQuestions: [
        expect.objectContaining({ requestId: (question as { requestId: string }).requestId }),
      ],
    });
  });

  test("applies delayed live context usage to the retained session", async () => {
    const transport = new RestoredUsageStreamTransport("runtime-live", false);
    const subscribeEvents = mock((runtimeId: string, listener) => {
      transport.emitRestoredUsage = (message) =>
        listener(withRuntimeReceivedAt({ runtimeId, kind: "notification", message }));
      return () => undefined;
    });
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: mock(() => transport),
    });

    await adapter.prepareRuntime("runtime-live");
    await expect(
      adapter.loadSessionContextUsage({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).resolves.toBeNull();
    expect(localSessions(adapter).has("thread-idle")).toBe(true);

    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
        contextUsage: { totalTokens: 42_000, contextWindow: 200_000 },
      }),
    );
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
    expect(transport.calls[resumeIndex]?.params).toEqual(
      expect.objectContaining({ threadId: "thread-idle", excludeTurns: true }),
    );
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
    const expectedMessage = "approvalPolicy";

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

  test("lists a completed unloaded child after reload", async () => {
    const transport = new ChildThreadListTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
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
        parentExternalSessionId: "parent-thread",
        ref: expect.objectContaining({ externalSessionId: "child-thread" }),
      }),
    ]);
  });

  test("retains completed routed descendants in the live projection until runtime release", async () => {
    const { adapter } = createHarness();
    await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      externalSessionId: "parent-thread",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    // SAFETY: This test controls the fixture and supplies the asserted shape used by this case.
    const adapterState = adapter as {
      subagents: {
        upsertLink(input: {
          runtimeId: string;
          parentThreadId: string;
          childThreadId: string;
          itemId: string;
          status: "completed";
        }): void;
      };
      pendingInput: CodexPendingInputState;
    };
    adapterState.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "completed",
    });
    const pendingQuestion = adapterState.pendingInput.addQuestion({
      runtimeId: "runtime-live",
      threadId: "grandchild-thread",
      nativeRequest: { id: "grandchild-question", method: "item/tool/requestUserInput" },
      request: {
        questions: [{ id: "question-1", header: "Proceed", question: "Continue?", options: [] }],
      },
      questionIds: ["question-1"],
      input: { requestId: "grandchild-question" },
      route: {
        runtimeId: "runtime-live",
        parentExternalSessionId: "child-thread",
        childExternalSessionId: "grandchild-thread",
        subagentCorrelationKey: "codex-subagent:child-thread:grandchild-thread",
      },
    });
    adapterState.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: "child-thread",
      childThreadId: "grandchild-thread",
      itemId: "spawn-2",
      status: "completed",
    });

    const snapshots = adapter.listLiveSessionSnapshots("runtime-live");
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        activity: "idle",
        parentExternalSessionId: "parent-thread",
        ref: expect.objectContaining({ externalSessionId: "child-thread" }),
      }),
    );
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        activity: "waiting_for_question",
        parentExternalSessionId: "child-thread",
        ref: expect.objectContaining({ externalSessionId: "grandchild-thread" }),
        pendingQuestions: [
          expect.objectContaining({ requestId: pendingQuestion.entry.request.requestId }),
        ],
      }),
    );
    expect(localSessions(adapter).has("child-thread")).toBe(false);
    expect(localSessions(adapter).has("grandchild-thread")).toBe(false);
  });

  test("replays mirrored pending input when subscribing an idle parent without a local session", async () => {
    const { adapter } = createHarness({
      transportFactory: mock(() => new IdleParentThreadListTransport("runtime-live", false)),
    });
    // SAFETY: This test controls the fixture and supplies `{ pendingInput: CodexPendingInputState }` used by this case.
    const adapterState = adapter as { pendingInput: CodexPendingInputState };
    adapterState.pendingInput.addQuestion({
      runtimeId: "runtime-live",
      threadId: "child-thread",
      nativeRequest: {
        id: "question-1",
        method: "item/tool/requestUserInput",
      },
      request: {
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
    adapterState.pendingInput.addQuestion({
      runtimeId: "runtime-other",
      threadId: "child-other",
      nativeRequest: {
        id: "question-other-runtime",
        method: "item/tool/requestUserInput",
      },
      request: {
        questions: [
          {
            id: "question-item-other",
            header: "Wrong runtime",
            question: "Should not replay?",
            options: ["Yes", "No"],
          },
        ],
      },
      questionIds: ["question-item-other"],
      input: { requestId: "question-other-runtime" },
      route: {
        runtimeId: "runtime-other",
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-other",
        subagentCorrelationKey: "codex-subagent:parent-thread:spawn-other",
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
      expect(events).not.toContainEqual(
        expect.objectContaining({ requestId: "question-other-runtime" }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("configures a discovered workflow parent before retaining it for an active child", async () => {
    const transport = new IdleParentWithActiveChildTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("parent-thread"),
      () => {},
    );
    unsubscribe();

    expect(transport.calls).toContainEqual({
      method: "thread/resume",
      params: expect.objectContaining({
        threadId: "parent-thread",
        config: {
          "mcp_servers.openducktor.enabled": true,
          "mcp_servers.openducktor.enabled_tools": [...AGENT_ROLE_TOOL_POLICY.build],
        },
      }),
    });
  });
});

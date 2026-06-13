import { describe, expect, mock, test } from "bun:test";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
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

class RestoreIdleThreadListActiveTransport extends MutableThreadListTransport {
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

class HistoryOnlyIdleTransport extends RecordingTransport {
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
        startedAt: "2026-05-07T00:00:10.000Z",
      } as Response;
    }
    return super.request<Response>(request);
  }
}

const localSessions = (
  adapter: CodexAppServerAdapter,
): { has(externalSessionId: string): boolean } =>
  (adapter as unknown as { localSessions: { has(externalSessionId: string): boolean } })
    .localSessions;

const restoreSessionState = async (
  adapter: CodexAppServerAdapter,
  externalSessionId: string,
): Promise<void> => {
  await adapter.restoreSession(codexSessionRef(externalSessionId));
  adapter.subscribeEvents(codexSessionRuntimeRef(externalSessionId), () => {});
  await flushCodexAdapterWork();
};

describe("CodexAppServerAdapter presence", () => {
  test("refreshes Codex thread inventory during presence checks", async () => {
    const { adapter, transports } = createHarness();

    await expect(
      adapter.listLiveAgentSessions({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ externalSessionId: "thread-saved" }),
      expect.objectContaining({ externalSessionId: "thread-idle" }),
    ]);
    await expect(
      adapter.listSessionPresence({
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
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        presence: "runtime",
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

    await restoreSessionState(adapter, "thread-saved");

    transport.threadSavedStatus = { type: "idle" };

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      classification: "idle",
      agentSessionStatus: "idle",
      status: { type: "idle" },
    });
  });

  test("detects live Codex sessions from App Server after adapter refresh", async () => {
    const { adapter, transports } = createHarness();

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
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

  test("does not treat a history-only idle Codex resume as running presence", async () => {
    const transport = new HistoryOnlyIdleTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(true);
    transport.threadStatus = { type: "active", activeFlags: [] };

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      classification: "idle",
      agentSessionStatus: "idle",
      status: { type: "idle" },
    });
    await expect(
      adapter.listSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        classification: "idle",
        agentSessionStatus: "idle",
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    );
    await expect(
      adapter.listLiveAgentSessions({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        externalSessionId: "thread-idle",
        status: { type: "idle" },
      }),
    );
    expect(localSessions(adapter).has("thread-idle")).toBe(false);
  });

  test("keeps real pending input visible after a history-only Codex resume", async () => {
    const transport = new HistoryOnlyIdleTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(true);
    transport.threadStatus = { type: "active", activeFlags: ["waitingOnUserInput"] };

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      classification: "waiting_for_question",
      agentSessionStatus: "running",
      status: { type: "busy" },
    });
  });

  test("clears a history-only idle marker when the Codex thread disappears", async () => {
    const transport = new HistoryOnlyIdleTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-idle",
    });
    expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(true);

    transport.loaded = false;
    transport.includeThread = false;
    await expect(
      adapter.listLiveAgentSessions({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([]);

    transport.loaded = true;
    transport.includeThread = true;
    transport.threadStatus = { type: "active", activeFlags: [] };

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      classification: "running",
      agentSessionStatus: "running",
      status: { type: "busy" },
    });
  });

  test("lists loaded Codex sessions from App Server", async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.listLiveAgentSessions({
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      {
        externalSessionId: "thread-saved",
        title: "Saved running session",
        workingDirectory: "/repo",
        startedAt: "2026-05-07T00:00:00.000Z",
        status: { type: "busy" },
      },
      {
        externalSessionId: "thread-idle",
        title: "Saved idle session",
        workingDirectory: "/repo",
        startedAt: "2026-05-07T00:00:10.000Z",
        status: { type: "idle" },
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
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: summary.externalSessionId,
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      agentSessionStatus: "running",
      title: "BUILD task-1",
      ref: expect.objectContaining({ externalSessionId: summary.externalSessionId }),
    });
  });

  test("restores a missing live Codex session without starting a turn", async () => {
    const { adapter, transports } = createHarness();

    await restoreSessionState(adapter, "thread-saved");

    expect(localSessions(adapter).has("thread-saved")).toBe(true);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toContain(
      "thread/resume",
    );
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).not.toContain(
      "turn/start",
    );
  });

  test("trusts active inventory over an idle restore response during reload", async () => {
    const transport = new RestoreIdleThreadListActiveTransport("runtime-live", false);
    const { adapter } = createHarness({
      transportFactory: mock(() => transport),
    });

    await restoreSessionState(adapter, "thread-saved");

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({
      classification: "running",
      agentSessionStatus: "running",
      status: { type: "busy" },
    });
  });

  test("restores an idle Codex thread without marking it running", async () => {
    const { adapter } = createHarness();

    await restoreSessionState(adapter, "thread-idle");

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({ classification: "idle", agentSessionStatus: "idle" });
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
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-idle",
      }),
    ).resolves.toMatchObject({ classification: "idle", agentSessionStatus: "idle" });
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

  test("streams messages and completion after refresh restore", async () => {
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

    await restoreSessionState(adapter, "thread-saved");

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
    const unsubscribe = adapter.subscribeEvents(codexSessionRuntimeRef("thread-saved"), (event) =>
      events.push(event),
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
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle", agentSessionStatus: "idle" });
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

    await restoreSessionState(adapter, "thread-saved");

    const events: unknown[] = [];
    const unsubscribe = adapter.subscribeEvents(codexSessionRuntimeRef("thread-saved"), (event) =>
      events.push(event),
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
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle", agentSessionStatus: "idle" });
    unsubscribe();
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
    const unsubscribe = adapter.subscribeEvents(codexSessionRuntimeRef("thread-saved"), (event) =>
      events.push(event),
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
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toMatchObject({ classification: "idle", agentSessionStatus: "idle" });
    expect(drainNotifications).not.toHaveBeenCalled();
    expect(drainServerRequests).not.toHaveBeenCalled();
    unsubscribe();
  });
});

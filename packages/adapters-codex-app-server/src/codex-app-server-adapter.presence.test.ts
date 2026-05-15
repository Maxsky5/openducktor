import { describe, expect, mock, test } from "bun:test";
import { createHarness, waitForEvent } from "./codex-app-server-adapter.test-harness";

describe("CodexAppServerAdapter presence", () => {
  test("uses one Codex thread inventory during startup presence checks", async () => {
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
    expect(transport?.calls.filter((call) => call.method === "thread/loaded/list")).toHaveLength(1);
    expect(transport?.calls.filter((call) => call.method === "thread/list")).toHaveLength(1);
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
    expect(transport?.calls.filter((call) => call.method === "thread/loaded/list")).toHaveLength(1);
    expect(transport?.calls.filter((call) => call.method === "thread/list")).toHaveLength(1);
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
      runtimeId: "runtime-live",
      ref: expect.objectContaining({
        externalSessionId: "thread-saved",
        workingDirectory: "/repo",
      }),
    });

    expect(adapter.hasSession("thread-saved")).toBe(false);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toContain(
      "thread/loaded/list",
    );
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

  test("attaches a missing live Codex session without starting a turn", async () => {
    const { adapter, transports } = createHarness();

    await expect(
      adapter.attachSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        taskId: "task-1",
        role: "build",
        systemPrompt: "Use the repo rules.",
        externalSessionId: "thread-saved",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).resolves.toMatchObject({ externalSessionId: "thread-saved" });

    expect(adapter.hasSession("thread-saved")).toBe(true);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toContain(
      "thread/resume",
    );
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).not.toContain(
      "turn/start",
    );
  });

  test("streams messages and completion after refresh attach", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainNotifications = mock(async () => [] as unknown[]);
    const drainServerRequests = mock(async () => [] as unknown[]);
    const { adapter } = createHarness({ drainNotifications, drainServerRequests, subscribeEvents });

    await adapter.attachSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      externalSessionId: "thread-saved",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

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
    const unsubscribe = adapter.subscribeEvents("thread-saved", (event) => events.push(event));
    for (const message of notifications) {
      streamListeners[0]?.({ runtimeId: "runtime-live", kind: "notification", message });
    }

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

  test("streams messages and completion after refresh resume reattach", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainNotifications = mock(async () => [] as unknown[]);
    const drainServerRequests = mock(async () => [] as unknown[]);
    const { adapter } = createHarness({ drainNotifications, drainServerRequests, subscribeEvents });

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
    const unsubscribe = adapter.subscribeEvents("thread-saved", (event) => events.push(event));
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
    expect(drainNotifications).not.toHaveBeenCalled();
    expect(drainServerRequests).not.toHaveBeenCalled();
    unsubscribe();
  });
});

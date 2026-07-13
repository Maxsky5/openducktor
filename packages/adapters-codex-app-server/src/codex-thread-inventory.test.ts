import { describe, expect, test } from "bun:test";
import { createDeferred } from "./codex-app-server-adapter.test-harness";
import { codexThreadStatusSnapshot } from "./codex-app-server-threads";
import { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexAppServerClient } from "./types";

const threadListResponse = (
  id: string,
  preview: string,
  cwd = "/repo",
  status: Record<string, unknown> = { type: "idle" },
  extra: Record<string, unknown> = {},
): unknown => ({
  data: [
    {
      id,
      cwd,
      createdAt: 1,
      preview,
      status,
      ...extra,
    },
  ],
  nextCursor: null,
});

const threadReadResponse = (
  id: string,
  cwd = "/repo",
  status: Record<string, unknown> = { type: "idle" },
  turns: unknown[] = [{ id: "turn-1", status: "completed", items: [] }],
  extra: Record<string, unknown> = {},
): unknown => ({
  thread: {
    id,
    cwd,
    createdAt: 1,
    preview: "Stored thread",
    status,
    turns,
    ...extra,
  },
});

describe("CodexThreadInventoryReader", () => {
  test("requests interactive and subagent thread sources from Codex", async () => {
    const threadListCalls: Array<Record<string, unknown>> = [];
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadLoadedList: async () => ({ data: [], nextCursor: null }),
      threadList: async (params: Record<string, unknown>) => {
        threadListCalls.push(params);
        return { data: [], nextCursor: null };
      },
    } as unknown as CodexAppServerClient;

    await reader.refresh(client, "runtime-1");

    expect(threadListCalls).toEqual([
      {
        cursor: null,
        limit: 100,
        sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "unknown"],
      },
    ]);
  });

  test("reads every parent turn id with summary-only pagination", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadTurnsList: async (params: Record<string, unknown>) => {
        calls.push(params);
        return params.cursor
          ? { data: [{ id: "turn-2" }], nextCursor: null }
          : { data: [{ id: "turn-1" }], nextCursor: "page-2" };
      },
    } as unknown as CodexAppServerClient;

    const turnIds = await reader.readThreadTurnIds(client, "parent-thread");

    expect([...turnIds]).toEqual(["turn-1", "turn-2"]);
    expect(calls).toEqual([
      {
        threadId: "parent-thread",
        cursor: null,
        limit: 100,
        sortDirection: "asc",
        itemsView: "summary",
      },
      {
        threadId: "parent-thread",
        cursor: "page-2",
        limit: 100,
        sortDirection: "asc",
        itemsView: "summary",
      },
    ]);
  });

  test("rejects malformed summary turn entries instead of returning an incomplete id set", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadTurnsList: async () => ({ data: [null], nextCursor: null }),
    } as unknown as CodexAppServerClient;

    await expect(reader.readThreadTurnIds(client, "parent-thread")).rejects.toThrow(
      "returned a summary turn without an id",
    );
  });

  test("does not let a stale in-flight read overwrite a refreshed inventory", async () => {
    const reader = new CodexThreadInventoryReader();
    const firstLoaded = createDeferred<unknown>();
    const firstThreads = createDeferred<unknown>();
    const refreshedLoaded = createDeferred<unknown>();
    const refreshedThreads = createDeferred<unknown>();
    const loadedResponses = [firstLoaded, refreshedLoaded];
    const threadResponses = [firstThreads, refreshedThreads];
    const client = {
      threadLoadedList: () => {
        const response = loadedResponses.shift();
        if (!response) {
          throw new Error("Unexpected thread/loaded/list call.");
        }
        return response.promise;
      },
      threadList: () => {
        const response = threadResponses.shift();
        if (!response) {
          throw new Error("Unexpected thread/list call.");
        }
        return response.promise;
      },
    } as unknown as CodexAppServerClient;

    const staleRead = reader.read(client, "runtime-1");
    const refreshedRead = reader.refresh(client, "runtime-1");
    refreshedLoaded.resolve({ data: ["thread-fresh"], nextCursor: null });
    refreshedThreads.resolve(threadListResponse("thread-fresh", "Fresh inventory"));

    await expect(refreshedRead).resolves.toMatchObject({ runtimeId: "runtime-1" });
    firstLoaded.resolve({ data: ["thread-stale"], nextCursor: null });
    firstThreads.resolve(threadListResponse("thread-stale", "Stale inventory"));
    await expect(staleRead).resolves.toMatchObject({ runtimeId: "runtime-1" });

    const cached = await reader.read(client, "runtime-1");
    expect(cached.threadsById.has("thread-fresh")).toBe(true);
    expect(cached.threadsById.has("thread-stale")).toBe(false);
  });

  test("coalesces concurrent refreshes for the same runtime", async () => {
    const reader = new CodexThreadInventoryReader();
    const loaded = createDeferred<unknown>();
    const threads = createDeferred<unknown>();
    const calls: string[] = [];
    const client = {
      threadLoadedList: () => {
        calls.push("thread/loaded/list");
        return loaded.promise;
      },
      threadList: () => {
        calls.push("thread/list");
        return threads.promise;
      },
    } as unknown as CodexAppServerClient;

    const firstRefresh = reader.refresh(client, "runtime-1");
    const secondRefresh = reader.refresh(client, "runtime-1");
    expect(calls).toEqual(["thread/loaded/list", "thread/list"]);

    loaded.resolve({ data: ["thread-1"], nextCursor: null });
    threads.resolve(threadListResponse("thread-1", "Shared inventory"));

    const [firstInventory, secondInventory] = await Promise.all([firstRefresh, secondRefresh]);
    expect(firstInventory).toBe(secondInventory);
    expect(firstInventory.threadsById.has("thread-1")).toBe(true);
    expect(calls).toEqual(["thread/loaded/list", "thread/list"]);
  });

  test("applies runtime status updates to cached inventory", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadLoadedList: async () => ({ data: ["thread-1"], nextCursor: null }),
      threadList: async () =>
        threadListResponse("thread-1", "Cached inventory", "/repo", {
          type: "active",
          activeFlags: [],
        }),
    } as unknown as CodexAppServerClient;

    await reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));

    const cached = await reader.read(client, "runtime-1");
    expect(cached.threadsById.get("thread-1")?.status).toEqual({ classification: "idle" });
  });

  test("extracts Codex subagent parent and label metadata from thread list", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadLoadedList: async () => ({ data: ["child-thread"], nextCursor: null }),
      threadList: async () =>
        threadListResponse(
          "child-thread",
          "Child inventory",
          "/repo",
          { type: "idle" },
          {
            parentThreadId: "parent-thread",
            agentNickname: "reviewer",
            agentRole: "review",
            source: {
              subAgent: {
                thread_spawn: {
                  parent_thread_id: "parent-thread",
                  depth: 1,
                  agent_path: "/root/reviewer",
                  agent_nickname: "reviewer",
                  agent_role: "review",
                },
              },
            },
          },
        ),
    } as unknown as CodexAppServerClient;

    const inventory = await reader.refresh(client, "runtime-1");

    expect(inventory.threadsById.get("child-thread")).toMatchObject({
      parentThreadId: "parent-thread",
      agentNickname: "reviewer",
      agentRole: "review",
      subAgentSource: {
        parentThreadId: "parent-thread",
        depth: 1,
        agentPath: "/root/reviewer",
        agentNickname: "reviewer",
        agentRole: "review",
      },
    });
  });

  test("clears a runtime status override without refetching inventory", async () => {
    const reader = new CodexThreadInventoryReader();
    const calls: string[] = [];
    const client = {
      threadLoadedList: async () => {
        calls.push("thread/loaded/list");
        return { data: ["thread-1"], nextCursor: null };
      },
      threadList: async () => {
        calls.push("thread/list");
        return threadListResponse("thread-1", "Cached inventory", "/repo", {
          type: "active",
          activeFlags: [],
        });
      },
    } as unknown as CodexAppServerClient;

    await reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));
    expect((await reader.read(client, "runtime-1")).threadsById.get("thread-1")?.status).toEqual({
      classification: "idle",
    });

    reader.clearThreadStatus("runtime-1", "thread-1");

    expect((await reader.read(client, "runtime-1")).threadsById.get("thread-1")?.status).toEqual({
      classification: "running",
    });
    expect(calls).toEqual(["thread/loaded/list", "thread/list"]);
  });

  test("clears one runtime status override without touching other sessions", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadLoadedList: async () => ({
        data: ["thread-1", "thread-2"],
        nextCursor: null,
      }),
      threadList: async () => ({
        data: [
          {
            id: "thread-1",
            cwd: "/repo",
            createdAt: 1,
            preview: "First thread",
            status: { type: "active", activeFlags: [] },
          },
          {
            id: "thread-2",
            cwd: "/repo",
            createdAt: 1,
            preview: "Second thread",
            status: { type: "active", activeFlags: [] },
          },
        ],
        nextCursor: null,
      }),
    } as unknown as CodexAppServerClient;

    await reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));
    reader.updateThreadStatus("runtime-1", "thread-2", codexThreadStatusSnapshot("idle"));

    reader.clearThreadStatus("runtime-1", "thread-1");

    const cached = await reader.read(client, "runtime-1");
    expect(cached.threadsById.get("thread-1")?.status).toEqual({ classification: "running" });
    expect(cached.threadsById.get("thread-2")?.status).toEqual({ classification: "idle" });
  });

  test("clears raw inventory without clearing status overrides", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadLoadedList: async () => ({ data: ["thread-1"], nextCursor: null }),
      threadList: async () =>
        threadListResponse("thread-1", "Cached inventory", "/repo", {
          type: "active",
          activeFlags: [],
        }),
    } as unknown as CodexAppServerClient;

    await reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));

    reader.clearInventory("runtime-1");

    const refreshed = await reader.read(client, "runtime-1");
    expect(refreshed.threadsById.get("thread-1")?.status).toEqual({ classification: "idle" });
  });

  test("applies runtime status updates to in-flight inventory reads", async () => {
    const reader = new CodexThreadInventoryReader();
    const loaded = createDeferred<unknown>();
    const threads = createDeferred<unknown>();
    const client = {
      threadLoadedList: () => loaded.promise,
      threadList: () => threads.promise,
    } as unknown as CodexAppServerClient;

    const inventoryRead = reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));
    loaded.resolve({ data: ["thread-1"], nextCursor: null });
    threads.resolve(
      threadListResponse("thread-1", "Stale inventory", "/repo", {
        type: "active",
        activeFlags: [],
      }),
    );

    const inventory = await inventoryRead;
    expect(inventory.threadsById.get("thread-1")?.status).toEqual({ classification: "idle" });
  });

  test("reads stored threads for history without resuming them", async () => {
    const reader = new CodexThreadInventoryReader();
    const calls: string[] = [];
    const client = {
      threadRead: async () => {
        calls.push("thread/read");
        return threadReadResponse("thread-idle");
      },
      threadTurnsList: async () => {
        calls.push("thread/turns/list");
        return { data: [] };
      },
    } as unknown as CodexAppServerClient;

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toEqual(threadReadResponse("thread-idle"));
    expect(calls).toEqual(["thread/read", "thread/turns/list"]);
  });

  test("returns null when read-only history has no stored thread", async () => {
    const reader = new CodexThreadInventoryReader();
    const calls: string[] = [];
    const client = {
      threadRead: async () => {
        calls.push("thread/read");
        throw new Error("thread not loaded: thread-idle");
      },
    } as unknown as CodexAppServerClient;

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toBeNull();
    expect(calls).toEqual(["thread/read"]);
  });

  test("preserves a synthetic empty history response for a known local session", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadRead: async () => {
        throw new Error(
          "thread is not materialized yet: includeTurns is unavailable before first user message",
        );
      },
    } as unknown as CodexAppServerClient;

    await expect(
      reader.readThreadHistory(client, {
        externalSessionId: "thread-local",
        workingDirectory: "/repo",
        allowUnmaterialized: true,
      }),
    ).resolves.toEqual({ thread: { id: "thread-local", cwd: "/repo", turns: [] } });
  });

  test("returns null when read-only history cwd does not match", async () => {
    const reader = new CodexThreadInventoryReader();
    const calls: string[] = [];
    const client = {
      threadRead: async () => {
        calls.push("thread/read");
        return threadReadResponse("thread-idle", "/other");
      },
      threadTurnsList: async () => {
        calls.push("thread/turns/list");
        return { data: [] };
      },
    } as unknown as CodexAppServerClient;

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toBeNull();
    expect(calls).toEqual(["thread/read", "thread/turns/list"]);
  });

  test("propagates thread/read history failures", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadRead: async () => {
        throw new Error("read failed");
      },
    } as unknown as CodexAppServerClient;

    await expect(
      reader.readThreadHistory(client, {
        externalSessionId: "thread-idle",
        workingDirectory: "/repo",
      }),
    ).rejects.toThrow("read failed");
  });

  test("read-only history does not wait for an in-flight inventory read", async () => {
    const reader = new CodexThreadInventoryReader();
    const loaded = createDeferred<unknown>();
    const threads = createDeferred<unknown>();
    const calls: string[] = [];
    const client = {
      threadLoadedList: () => {
        calls.push("thread/loaded/list");
        return loaded.promise;
      },
      threadList: () => {
        calls.push("thread/list");
        return threads.promise;
      },
      threadRead: async () => {
        calls.push("thread/read");
        return threadReadResponse("thread-idle");
      },
      threadTurnsList: async () => {
        calls.push("thread/turns/list");
        return { data: [] };
      },
    } as unknown as CodexAppServerClient;

    const pendingRead = reader.read(client, "runtime-1");
    const pendingHistoryLoad = reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });
    loaded.resolve({ data: [], nextCursor: null });
    threads.resolve(threadListResponse("thread-idle", "Idle inventory"));

    await expect(pendingRead).resolves.toMatchObject({ runtimeId: "runtime-1" });
    await expect(pendingHistoryLoad).resolves.toEqual(threadReadResponse("thread-idle"));
    expect(calls).toEqual([
      "thread/loaded/list",
      "thread/list",
      "thread/read",
      "thread/turns/list",
    ]);
  });
});

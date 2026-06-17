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
): unknown => ({
  data: [
    {
      id,
      cwd,
      createdAt: 1,
      preview,
      status,
    },
  ],
  nextCursor: null,
});

const threadReadResponse = (
  id: string,
  cwd = "/repo",
  status: Record<string, unknown> = { type: "idle" },
  turns: unknown[] = [{ id: "turn-1", status: "completed", items: [] }],
): unknown => ({
  thread: {
    id,
    cwd,
    createdAt: 1,
    preview: "Stored thread",
    status,
    turns,
  },
});

describe("CodexThreadInventoryReader", () => {
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

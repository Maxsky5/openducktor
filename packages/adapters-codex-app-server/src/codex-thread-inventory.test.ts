import { describe, expect, test } from "bun:test";
import type {
  CodexAppServerThread,
  CodexAppServerThreadListParams,
  CodexAppServerThreadListResponse,
  CodexAppServerThreadLoadedListResponse,
  CodexAppServerThreadReadResponse,
  CodexAppServerThreadStatus,
  CodexAppServerThreadTurnsListParams,
  CodexAppServerTurn,
} from "@openducktor/contracts";
import { createCodexAppServerClient } from "./app-server-client";
import {
  codexThreadFixture,
  codexTurnFixture,
  createDeferred,
} from "./codex-app-server-adapter.test-harness";
import { codexThreadList, codexThreadStatusSnapshot } from "./codex-app-server-threads";
import { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexAppServerClient, CodexJsonRpcRequest } from "./types";

type InventoryClientOverrides = Partial<
  Pick<CodexAppServerClient, "threadList" | "threadLoadedList" | "threadRead" | "threadTurnsList">
>;

const createInventoryClient = (overrides: InventoryClientOverrides): CodexAppServerClient => ({
  ...createCodexAppServerClient({
    request: async (request) => {
      throw new Error(`Unexpected Codex request in inventory test: ${request.method}`);
    },
  }),
  ...overrides,
});

const threadListResponse = (
  id: string,
  preview: string,
  cwd = "/repo",
  status: CodexAppServerThreadStatus = { type: "idle" },
  overrides: Partial<CodexAppServerThread> = {},
): CodexAppServerThreadListResponse => ({
  data: [
    codexThreadFixture({
      id,
      cwd,
      createdAt: 1,
      updatedAt: 2,
      preview,
      status,
      ...overrides,
    }),
  ],
  nextCursor: null,
  backwardsCursor: null,
});

const threadReadResponse = (
  id: string,
  cwd = "/repo",
  status: CodexAppServerThreadStatus = { type: "idle" },
  turns: CodexAppServerTurn[] = [
    codexTurnFixture({ id: "turn-1", status: "completed", items: [] }),
  ],
): CodexAppServerThreadReadResponse => ({
  thread: codexThreadFixture({
    id,
    cwd,
    createdAt: 1,
    updatedAt: 2,
    preview: "Stored thread",
    status,
    turns,
  }),
});

describe("CodexThreadInventoryReader", () => {
  test("preserves the Codex thread update timestamp as a lifecycle watermark", () => {
    expect(codexThreadList(threadListResponse("thread-1", "Thread"))[0]?.updatedAtMs).toBe(2_000);
  });

  test("rejects overflowing Codex thread update timestamps", () => {
    expect(() =>
      codexThreadList(
        threadListResponse(
          "thread-1",
          "Thread",
          "/repo",
          { type: "idle" },
          {
            updatedAt: Number.MAX_VALUE,
          },
        ),
      ),
    ).toThrow("Codex thread updatedAt exceeds the supported timestamp range.");
  });

  test("requests interactive and subagent thread sources from Codex", async () => {
    const threadListCalls: CodexAppServerThreadListParams[] = [];
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadLoadedList: async () => ({ data: [], nextCursor: null }),
      threadList: async (params) => {
        threadListCalls.push(params);
        return { data: [], nextCursor: null };
      },
    });

    await reader.refresh(client, "runtime-1");

    expect(threadListCalls).toEqual([
      {
        cursor: null,
        limit: 100,
        sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "unknown"],
      },
    ]);
  });

  test("scopes startup inventory reads to the requested working directories and state database", async () => {
    const threadListCalls: CodexAppServerThreadListParams[] = [];
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadLoadedList: async () => ({ data: [], nextCursor: null }),
      threadList: async (params) => {
        threadListCalls.push(params);
        return { data: [], nextCursor: null };
      },
    });

    await reader.readForDirectories(client, "runtime-1", ["/repo", "/repo/worktree"]);

    expect(threadListCalls).toEqual([
      {
        cursor: null,
        limit: 100,
        sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "unknown"],
        cwd: ["/repo", "/repo/worktree"],
        useStateDbOnly: true,
      },
    ]);
  });

  test("reads every parent turn id with summary-only pagination", async () => {
    const calls: CodexAppServerThreadTurnsListParams[] = [];
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadTurnsList: async (params) => {
        calls.push(params);
        return params.cursor
          ? { data: [{ id: "turn-2" }], nextCursor: null }
          : { data: [{ id: "turn-1" }], nextCursor: "page-2" };
      },
    });

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

  test("does not let a stale in-flight read overwrite a refreshed inventory", async () => {
    const reader = new CodexThreadInventoryReader();
    const firstLoaded = createDeferred<CodexAppServerThreadLoadedListResponse>();
    const firstThreads = createDeferred<CodexAppServerThreadListResponse>();
    const refreshedLoaded = createDeferred<CodexAppServerThreadLoadedListResponse>();
    const refreshedThreads = createDeferred<CodexAppServerThreadListResponse>();
    const loadedResponses = [firstLoaded, refreshedLoaded];
    const threadResponses = [firstThreads, refreshedThreads];
    const client = createInventoryClient({
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
    });

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

  test("does not reuse a directory inventory read after clearing its runtime", async () => {
    const reader = new CodexThreadInventoryReader();
    const staleLoaded = createDeferred<CodexAppServerThreadLoadedListResponse>();
    const staleThreads = createDeferred<CodexAppServerThreadListResponse>();
    let loadedCalls = 0;
    let threadCalls = 0;
    const client = createInventoryClient({
      threadLoadedList: () => {
        loadedCalls += 1;
        return loadedCalls === 1
          ? staleLoaded.promise
          : Promise.resolve({ data: ["thread-fresh"], nextCursor: null });
      },
      threadList: () => {
        threadCalls += 1;
        return threadCalls === 1
          ? staleThreads.promise
          : Promise.resolve(threadListResponse("thread-fresh", "Fresh inventory"));
      },
    });

    const staleRead = reader.readForDirectories(client, "runtime-1", ["/repo"]);
    reader.clearInventory("runtime-1");
    const freshRead = reader.readForDirectories(client, "runtime-1", ["/repo"]);

    staleLoaded.resolve({ data: ["thread-stale"], nextCursor: null });
    staleThreads.resolve(threadListResponse("thread-stale", "Stale inventory"));
    const freshInventory = await freshRead;
    await staleRead;

    expect(freshInventory.threadsById.has("thread-fresh")).toBe(true);
    expect(freshInventory.threadsById.has("thread-stale")).toBe(false);
    expect([loadedCalls, threadCalls]).toEqual([2, 2]);
  });

  test("coalesces concurrent refreshes for the same runtime", async () => {
    const reader = new CodexThreadInventoryReader();
    const loaded = createDeferred<CodexAppServerThreadLoadedListResponse>();
    const threads = createDeferred<CodexAppServerThreadListResponse>();
    const calls: string[] = [];
    const client = createInventoryClient({
      threadLoadedList: () => {
        calls.push("thread/loaded/list");
        return loaded.promise;
      },
      threadList: () => {
        calls.push("thread/list");
        return threads.promise;
      },
    });

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
    const client = createInventoryClient({
      threadLoadedList: async () => ({ data: ["thread-1"], nextCursor: null }),
      threadList: async () =>
        threadListResponse("thread-1", "Cached inventory", "/repo", {
          type: "active",
          activeFlags: [],
        }),
    });

    await reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));

    const cached = await reader.read(client, "runtime-1");
    expect(cached.threadsById.get("thread-1")?.status).toEqual({ classification: "idle" });
  });

  test("extracts Codex subagent parent and label metadata from thread list", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
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
    });

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
    const client = createInventoryClient({
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
    });

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
    const client = createInventoryClient({
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
    });

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
    const client = createInventoryClient({
      threadLoadedList: async () => ({ data: ["thread-1"], nextCursor: null }),
      threadList: async () =>
        threadListResponse("thread-1", "Cached inventory", "/repo", {
          type: "active",
          activeFlags: [],
        }),
    });

    await reader.refresh(client, "runtime-1");
    reader.updateThreadStatus("runtime-1", "thread-1", codexThreadStatusSnapshot("idle"));

    reader.clearInventory("runtime-1");

    const refreshed = await reader.read(client, "runtime-1");
    expect(refreshed.threadsById.get("thread-1")?.status).toEqual({ classification: "idle" });
  });

  test("applies runtime status updates to in-flight inventory reads", async () => {
    const reader = new CodexThreadInventoryReader();
    const loaded = createDeferred<CodexAppServerThreadLoadedListResponse>();
    const threads = createDeferred<CodexAppServerThreadListResponse>();
    const client = createInventoryClient({
      threadLoadedList: () => loaded.promise,
      threadList: () => threads.promise,
    });

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
    const calls: CodexJsonRpcRequest[] = [];
    const pagedTurns: CodexAppServerTurn[] = [
      codexTurnFixture({
        id: "turn-1",
        status: "completed",
        items: [
          {
            type: "userMessage",
            id: "user-live-id",
            content: [{ type: "text", text: "Inspect the transcript." }],
          },
          {
            type: "agentMessage",
            id: "msg-live-id",
            text: "The transcript is intact.",
            phase: "final_answer",
          },
        ],
      }),
    ];
    const client = createInventoryClient({
      threadRead: async (params: Parameters<CodexAppServerClient["threadRead"]>[0]) => {
        calls.push({ method: "thread/read", params });
        return threadReadResponse("thread-idle", "/repo", { type: "idle" }, []);
      },
      threadTurnsList: async (params: Parameters<CodexAppServerClient["threadTurnsList"]>[0]) => {
        calls.push({ method: "thread/turns/list", params });
        return { data: pagedTurns, nextCursor: null };
      },
    });

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toEqual(
      threadReadResponse("thread-idle", "/repo", { type: "idle" }, pagedTurns),
    );
    expect(calls).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-idle", includeTurns: false },
      },
      {
        method: "thread/turns/list",
        params: {
          threadId: "thread-idle",
          cursor: null,
          limit: 100,
          sortDirection: "asc",
          itemsView: "full",
        },
      },
    ]);
  });

  test("uses an empty paginated history instead of stale thread metadata turns", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadRead: async () =>
        threadReadResponse("thread-idle", "/repo", { type: "idle" }, [
          {
            id: "stale-turn",
            status: "completed",
            items: [
              {
                id: "stale-message",
                type: "agentMessage",
                phase: "final_answer",
                text: "Stale metadata history",
              },
            ],
          },
        ]),
      threadTurnsList: async () => ({ data: [], nextCursor: null }),
    });

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toEqual(threadReadResponse("thread-idle", "/repo", { type: "idle" }, []));
  });

  test("returns null when read-only history has no stored thread", async () => {
    const reader = new CodexThreadInventoryReader();
    const calls: string[] = [];
    const client = createInventoryClient({
      threadRead: async () => {
        calls.push("thread/read");
        throw new Error("thread not loaded: thread-idle");
      },
    });

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toBeNull();
    expect(calls).toEqual(["thread/read"]);
  });

  test("preserves a synthetic empty history response for a known local session", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadRead: async () => {
        throw new Error(
          "thread is not materialized yet: includeTurns is unavailable before first user message",
        );
      },
    });

    await expect(
      reader.readThreadHistory(client, {
        externalSessionId: "thread-local",
        workingDirectory: "/repo",
        allowUnmaterialized: true,
      }),
    ).resolves.toEqual({ thread: { id: "thread-local", cwd: "/repo", turns: [] } });
  });

  test("preserves empty history when paginated turns are unavailable before the first message", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadRead: async () => threadReadResponse("thread-local"),
      threadTurnsList: async () => {
        throw new Error("thread/turns/list is unavailable before first user message");
      },
    });

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
    const client = createInventoryClient({
      threadRead: async () => {
        calls.push("thread/read");
        return threadReadResponse("thread-idle", "/other");
      },
      threadTurnsList: async () => {
        calls.push("thread/turns/list");
        return { data: [] };
      },
    });

    const historyLoad = await reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(historyLoad).toBeNull();
    expect(calls).toEqual(["thread/read", "thread/turns/list"]);
  });

  test("propagates thread/read history failures", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = createInventoryClient({
      threadRead: async () => {
        throw new Error("read failed");
      },
    });

    await expect(
      reader.readThreadHistory(client, {
        externalSessionId: "thread-idle",
        workingDirectory: "/repo",
      }),
    ).rejects.toThrow("read failed");
  });

  test("read-only history does not wait for an in-flight inventory read", async () => {
    const reader = new CodexThreadInventoryReader();
    const loaded = createDeferred<CodexAppServerThreadLoadedListResponse>();
    const threads = createDeferred<CodexAppServerThreadListResponse>();
    const calls: string[] = [];
    const client = createInventoryClient({
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
        return threadReadResponse("thread-idle", "/repo", { type: "idle" }, []);
      },
      threadTurnsList: async () => {
        calls.push("thread/turns/list");
        return { data: [{ id: "turn-1", status: "completed", items: [] }] };
      },
    });

    const pendingRead = reader.read(client, "runtime-1");
    const pendingHistoryLoad = reader.readThreadHistory(client, {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });
    loaded.resolve({ data: [], nextCursor: null });
    threads.resolve(threadListResponse("thread-idle", "Idle inventory"));

    await expect(pendingRead).resolves.toMatchObject({ runtimeId: "runtime-1" });
    await expect(pendingHistoryLoad).resolves.toEqual(
      threadReadResponse("thread-idle", "/repo", { type: "idle" }, [
        { id: "turn-1", status: "completed", items: [] },
      ]),
    );
    expect(calls).toEqual([
      "thread/loaded/list",
      "thread/list",
      "thread/read",
      "thread/turns/list",
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import { codexThreadStatusSnapshot } from "./codex-app-server-threads";
import { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexSessionRuntimeSnapshotReaderDeps } from "./codex-session-runtime-snapshot-reader";
import {
  listCodexSessionRuntimeSnapshots,
  readCodexSessionRuntimeSnapshot,
} from "./codex-session-runtime-snapshot-reader";
import type { CodexSessionState } from "./types";

const createChildThread = (): CodexThreadSnapshot => ({
  id: "child-thread",
  cwd: "/repo",
  startedAt: "2026-06-26T08:00:00.000Z",
  updatedAtMs: Date.parse("2026-06-26T08:01:00.000Z"),
  title: "Child thread",
  status: codexThreadStatusSnapshot("active"),
  parentThreadId: "parent-thread",
  agentNickname: null,
  agentRole: null,
  subAgentSource: null,
});

const createInventory = (thread: CodexThreadSnapshot): CodexThreadInventory => ({
  runtimeId: "runtime-1",
  loadedIds: new Set([thread.id]),
  threadsById: new Map([[thread.id, thread]]),
});

const createDeps = (
  inventory: CodexThreadInventory,
  sessions: CodexSessionState[] = [],
): CodexSessionRuntimeSnapshotReaderDeps => ({
  runtimeClients: {
    clientForRuntime: () => ({}) as never,
    resolve: async () => ({ runtimeId: "runtime-1", client: {} as never }),
  },
  threadInventory: {
    read: async () => inventory,
    refresh: async () => inventory,
    readForDirectories: async () => inventory,
  } as never,
  sessions: {
    get: (threadId) => sessions.find((session) => session.threadId === threadId),
    values: function* () {
      yield* sessions;
    },
  },
  pendingInput: new CodexPendingInputState(),
  hasActiveTurn: () => false,
});

describe("Codex session runtime snapshot reader", () => {
  test("reads one Codex inventory when local sessions use the resolved runtime", async () => {
    const thread = createChildThread();
    const inventory = createInventory(thread);
    const localSession: CodexSessionState = {
      summary: {
        externalSessionId: thread.id,
        runtimeKind: "codex",
        workingDirectory: "/repo",
        role: null,
        startedAt: thread.startedAt,
        status: "running",
      },
      systemPrompt: "",
      role: null,
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: thread.id,
      workingDirectory: "/repo",
      taskId: "task-1",
      liveStatus: codexThreadStatusSnapshot("active"),
    };
    const deps = createDeps(inventory, [localSession]);
    let inventoryReadCount = 0;
    deps.threadInventory = {
      read: async () => {
        inventoryReadCount += 1;
        return inventory;
      },
      refresh: async () => {
        inventoryReadCount += 1;
        return inventory;
      },
      readForDirectories: async () => {
        inventoryReadCount += 1;
        return inventory;
      },
    } as never;

    await expect(
      listCodexSessionRuntimeSnapshots(deps, {
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toHaveLength(1);

    expect(inventoryReadCount).toBe(1);
  });

  test("reads child parent metadata without learning a live route", async () => {
    await expect(
      readCodexSessionRuntimeSnapshot(createDeps(createInventory(createChildThread())), {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "child-thread",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      parentExternalSessionId: "parent-thread",
    });
  });

  test("preserves completed unloaded child inventory metadata", async () => {
    const child = {
      ...createChildThread(),
      status: codexThreadStatusSnapshot("notLoaded"),
    };
    const unrelatedMainThread = {
      ...child,
      id: "unloaded-main-thread",
      parentThreadId: null,
    };
    const inventory = {
      ...createInventory(child),
      loadedIds: new Set<string>(),
      threadsById: new Map([
        [child.id, child],
        [unrelatedMainThread.id, unrelatedMainThread],
      ]),
    };

    await expect(
      listCodexSessionRuntimeSnapshots(createDeps(inventory), {
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

  test("settles a previously materialized child during repository hydration", async () => {
    const child = {
      ...createChildThread(),
      status: codexThreadStatusSnapshot("notLoaded"),
    };
    const inventory = {
      ...createInventory(child),
      loadedIds: new Set<string>(),
    };
    const localChild: CodexSessionState = {
      summary: {
        externalSessionId: child.id,
        runtimeKind: "codex",
        workingDirectory: "/repo",
        role: null,
        startedAt: child.startedAt,
        status: "running",
      },
      systemPrompt: "",
      role: null,
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: child.id,
      workingDirectory: "/repo",
      taskId: "task-1",
      liveStatus: codexThreadStatusSnapshot("active"),
    };

    await expect(
      listCodexSessionRuntimeSnapshots(createDeps(inventory, [localChild]), {
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        classification: "idle",
        parentExternalSessionId: "parent-thread",
        ref: expect.objectContaining({ externalSessionId: "child-thread" }),
      }),
    ]);
  });
});

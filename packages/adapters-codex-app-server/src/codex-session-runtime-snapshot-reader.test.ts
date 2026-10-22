import { describe, expect, test } from "bun:test";
import { createCodexAppServerClient } from "./app-server-client";
import { defaultCodexEffectivePolicy } from "./codex-app-server-adapter.test-harness";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import { codexThreadStatusSnapshot } from "./codex-app-server-threads";
import { CodexAsyncQuestionState } from "./codex-async-questions";
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

const createSession = (
  thread: CodexThreadSnapshot,
  workingDirectory = "/repo",
): CodexSessionState => ({
  summary: {
    externalSessionId: thread.id,
    runtimeKind: "codex",
    workingDirectory,
    sessionAssociation: { kind: "unbound" },
    startedAt: thread.startedAt,
    status: "running",
  },
  systemPrompt: "",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  threadId: thread.id,
  workingDirectory,
  runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
  liveStatus: codexThreadStatusSnapshot("active"),
});

const createDeps = (
  inventory: CodexThreadInventory,
  sessions: CodexSessionState[] = [],
): CodexSessionRuntimeSnapshotReaderDeps => ({
  runtimeClients: {
    clientForRuntime: () => client,
    resolve: async () => ({ runtimeId: "runtime-1", client }),
  },
  threadInventory: {
    read: async () => inventory,
    refresh: async () => inventory,
    readForDirectories: async () => inventory,
  },
  sessions: {
    get: (threadId) => sessions.find((session) => session.threadId === threadId),
    values: function* () {
      yield* sessions;
    },
  },
  pendingInput: new CodexPendingInputState(),
  asyncQuestions: new CodexAsyncQuestionState(),
  hasActiveTurn: () => false,
  directoriesMatch: async (left, right) => left === right,
});

const client = createCodexAppServerClient({
  request: async (request) => {
    throw new Error(`Unexpected Codex request in runtime snapshot reader test: ${request.method}`);
  },
});

describe("Codex session runtime snapshot reader", () => {
  test("reads one Codex inventory when local sessions use the resolved runtime", async () => {
    const thread = createChildThread();
    const inventory = createInventory(thread);
    const localSession = createSession(thread);
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
    };

    await expect(
      listCodexSessionRuntimeSnapshots(deps, {
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: ["/repo"],
      }),
    ).resolves.toHaveLength(1);

    expect(inventoryReadCount).toBe(1);
  });

  test.each([
    { workingDirectory: "/repo", nativeDirectory: "/repo" },
    { workingDirectory: "/tmp/repo", nativeDirectory: "/private/tmp/repo" },
  ])(
    "reads child metadata in $workingDirectory without changing its reference",
    async ({ workingDirectory, nativeDirectory }) => {
      const child = { ...createChildThread(), cwd: nativeDirectory };
      const inventory = createInventory(child);
      inventory.threadsById.set("unrelated-thread", {
        ...child,
        id: "unrelated-thread",
        cwd: "/deleted-directory",
      });
      const deps = createDeps(inventory);
      const aliases = new Set([workingDirectory, nativeDirectory]);
      deps.directoriesMatch = async (left, right) => {
        if (!aliases.has(left) || !aliases.has(right)) {
          throw new Error("Directory check must only inspect the selected thread");
        }
        return true;
      };
      const input = {
        repoPath: "/repo",
        runtimeKind: "codex" as const,
        workingDirectory,
        externalSessionId: "child-thread",
      };

      expect(await readCodexSessionRuntimeSnapshot(deps, input)).toMatchObject({
        availability: "runtime",
        parentExternalSessionId: "parent-thread",
        ref: input,
      });
    },
  );

  test.each([false, true])(
    "rejects a different directory with local registration %s",
    async (registered) => {
      const child = { ...createChildThread(), cwd: "/other-repo" };
      const deps = createDeps(createInventory(child), registered ? [createSession(child)] : []);
      const input = {
        repoPath: "/repo",
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
        externalSessionId: child.id,
      };

      expect(await readCodexSessionRuntimeSnapshot(deps, input)).toEqual({
        availability: "missing",
        classification: "missing",
        ref: input,
        pendingApprovals: [],
        pendingQuestions: [],
      });
    },
  );

  test("does not admit an unregistered child from runtime inventory", async () => {
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
    ).resolves.toEqual([]);
  });

  test("settles a previously materialized child during repository hydration", async () => {
    const child = {
      ...createChildThread(),
      cwd: "/private/tmp/repo",
      status: codexThreadStatusSnapshot("notLoaded"),
    };
    const inventory = {
      ...createInventory(child),
      loadedIds: new Set<string>(),
    };
    const localChild = createSession(child, "/tmp/repo");

    const deps = createDeps(inventory, [localChild]);
    const aliases = new Set([child.cwd, localChild.workingDirectory]);
    deps.directoriesMatch = async (left, right) => aliases.has(left) && aliases.has(right);

    await expect(
      listCodexSessionRuntimeSnapshots(deps, {
        repoPath: "/repo",
        runtimeKind: "codex",
        directories: [localChild.workingDirectory],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        classification: "idle",
        parentExternalSessionId: "parent-thread",
        ref: expect.objectContaining({
          externalSessionId: "child-thread",
          workingDirectory: "/tmp/repo",
        }),
      }),
    ]);
  });
});

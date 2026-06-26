import { describe, expect, test } from "bun:test";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import { codexThreadStatusSnapshot } from "./codex-app-server-threads";
import { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexSessionRuntimeSnapshotReaderDeps } from "./codex-session-runtime-snapshot-reader";
import { readCodexSessionRuntimeSnapshot } from "./codex-session-runtime-snapshot-reader";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";

const createChildThread = (): CodexThreadSnapshot => ({
  id: "child-thread",
  cwd: "/repo",
  startedAt: "2026-06-26T08:00:00.000Z",
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

const createDeps = (inventory: CodexThreadInventory): CodexSessionRuntimeSnapshotReaderDeps => ({
  runtimeClients: {
    clientForRuntime: () => ({}) as never,
    resolve: async () => ({ runtimeId: "runtime-1", client: {} as never }),
  },
  threadInventory: {
    read: async () => inventory,
    refresh: async () => inventory,
  } as never,
  sessions: {
    get: () => undefined,
    values: function* () {
      yield* [];
    },
  },
  pendingInput: new CodexPendingInputState(),
  hasActiveTurn: () => false,
});

describe("Codex session runtime snapshot reader", () => {
  test("reads child parent metadata without learning a live route", async () => {
    const subagents = new CodexSubagentLinkState();
    let learnedRoutes = 0;
    subagents.onRouteLearned(() => {
      learnedRoutes += 1;
    });

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
    expect(learnedRoutes).toBe(0);
  });
});

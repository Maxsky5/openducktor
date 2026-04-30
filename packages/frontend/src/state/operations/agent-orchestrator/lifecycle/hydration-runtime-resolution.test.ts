import { describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection } from "@openducktor/core";
import { createLiveAgentSessionSnapshotFixture } from "../test-utils";
import { createHydrationRuntimeResolver } from "./hydration-runtime-resolution";
import {
  liveAgentSessionLookupKey,
  RuntimeConnectionPreloadIndex,
} from "./live-agent-session-cache";

const createRecord = (
  role: AgentSessionRecord["role"],
  workingDirectory: string,
): AgentSessionRecord => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role,
  scenario: role === "qa" ? "qa_review" : "build_implementation_start",
  startedAt: "2026-03-01T10:00:00.000Z",
  workingDirectory,
  selectedModel: null,
});

const createRuntime = (workingDirectory: string): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory,
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4555",
  },
  startedAt: "2026-03-01T10:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const createStdioRuntime = (
  runtimeId: string,
  workingDirectory: string,
): RuntimeInstanceSummary => ({
  ...createRuntime(workingDirectory),
  runtimeId,
  runtimeRoute: {
    type: "stdio",
    identity: runtimeId,
  },
});

const createPreloadIndex = (
  connections: AgentRuntimeConnection[],
): RuntimeConnectionPreloadIndex => {
  const preloadIndex = new RuntimeConnectionPreloadIndex();
  for (const runtimeConnection of connections) {
    preloadIndex.add("opencode", runtimeConnection);
  }
  return preloadIndex;
};

describe("createHydrationRuntimeResolver", () => {
  test("prefers live runtime resolution over preloaded runtime connections", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const preloadedRuntimeConnection: AgentRuntimeConnection = {
      type: "local_http",
      endpoint: "http://127.0.0.1:9999",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([preloadedRuntimeConnection]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime(workingDirectory)]],
      ]),
      preloadedRuntimeConnections,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("qa", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBe("runtime-1");
    expect(result.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
  });

  test("fails fast for build worktree sessions when only the workspace runtime exists", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime("/tmp/repo")]],
      ]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(
      createRecord("build", "/tmp/openducktor-worktrees/task-1"),
    );
    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/openducktor-worktrees/task-1.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("uses exact preloaded snapshots to disambiguate worktree stdio connections", async () => {
    const workingDirectory = "/tmp/openducktor-worktrees/task-1";
    const runtimeConnectionA: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-a",
      workingDirectory,
    };
    const runtimeConnectionB: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-b",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([
      runtimeConnectionA,
      runtimeConnectionB,
    ]);
    const preloadedLiveAgentSessionsByKey = new Map([
      [
        liveAgentSessionLookupKey("opencode", runtimeConnectionB, workingDirectory),
        [
          createLiveAgentSessionSnapshotFixture({
            externalSessionId: "external-1",
            workingDirectory,
          }),
        ],
      ],
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      preloadedLiveAgentSessionsByKey,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("build", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBeNull();
    expect(result.runtimeConnection).toEqual(runtimeConnectionB);
    expect(result.runtimeRoute).toEqual({ type: "stdio", identity: "runtime-stdio-b" });
  });

  test("fails fast for repo-root build sessions when no live runtime exists", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return createRuntime("/tmp/repo");
      },
    });

    const result = await resolveHydrationRuntime(createRecord("build", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/repo.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("fails fast for repo-root build sessions when only the workspace runtime exists", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime("/tmp/repo")]],
      ]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("build", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/repo.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("fails fast for repo-root qa sessions when only the workspace runtime exists", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime("/tmp/repo")]],
      ]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("qa", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/repo.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("fails fast for repo-root build sessions when only a preloaded runtime connection exists", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnections = createPreloadIndex([
      {
        type: "local_http",
        endpoint: "http://127.0.0.1:9999",
        workingDirectory,
      },
    ]);
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("build", workingDirectory));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/repo.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("fails fast for repo-root qa sessions when only a preloaded runtime connection exists", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnections = createPreloadIndex([
      {
        type: "local_http",
        endpoint: "http://127.0.0.1:9999",
        workingDirectory,
      },
    ]);
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("qa", workingDirectory));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/repo.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("does not ensure a shared workspace runtime for build sessions on non-root directories", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return createRuntime("/tmp/repo");
      },
    });

    const result = await resolveHydrationRuntime(createRecord("build", "/tmp/other"));
    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/other.",
    });
    expect(ensureCalls).toBe(0);
  });

  test("falls back to preloaded runtime connection when no run or runtime exists", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnection: AgentRuntimeConnection = {
      type: "local_http",
      endpoint: "http://127.0.0.1:9999",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([preloadedRuntimeConnection]);
    let ensureCalls = 0;

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("planner", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBeNull();
    expect(result.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:9999",
    });
    expect(ensureCalls).toBe(0);
  });

  test("uses a single preloaded runtime connection when preloaded snapshots do not match the record", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const preloadedRuntimeConnection: AgentRuntimeConnection = {
      type: "local_http",
      endpoint: "http://127.0.0.1:9999",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([preloadedRuntimeConnection]);
    const preloadedLiveAgentSessionsByKey = new Map([
      [
        liveAgentSessionLookupKey("opencode", preloadedRuntimeConnection, workingDirectory),
        [
          createLiveAgentSessionSnapshotFixture({
            externalSessionId: "other-external-session",
            workingDirectory,
          }),
        ],
      ],
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      preloadedLiveAgentSessionsByKey,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("build", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBeNull();
    expect(result.runtimeConnection).toEqual(preloadedRuntimeConnection);
  });

  test("preserves stdio preloaded runtime connections during hydration fallback", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnection: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([preloadedRuntimeConnection]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("planner", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBeNull();
    expect(result.runtimeConnection).toEqual({
      type: "stdio",
      identity: "runtime-stdio",
      workingDirectory,
    });
    expect(result.runtimeRoute).toEqual({
      type: "stdio",
      identity: "runtime-stdio",
    });
  });

  test("fails fast when multiple stdio runtimes match the same working directory", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        [
          "opencode",
          [
            createStdioRuntime("runtime-stdio-a", workingDirectory),
            createStdioRuntime("runtime-stdio-b", workingDirectory),
          ],
        ],
      ]),
      ensureWorkspaceRuntime: async () => null,
    });

    await expect(
      resolveHydrationRuntime(createRecord("planner", workingDirectory)),
    ).resolves.toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: `Multiple live stdio runtimes found for working directory ${workingDirectory}.`,
    });
  });

  test("uses preloaded snapshots to disambiguate same-directory live stdio runtimes", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const runtimeConnectionA: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-a",
      workingDirectory,
    };
    const runtimeConnectionB: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-b",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([
      runtimeConnectionA,
      runtimeConnectionB,
    ]);
    const preloadedLiveAgentSessionsByKey = new Map([
      [
        liveAgentSessionLookupKey("opencode", runtimeConnectionB, workingDirectory),
        [
          createLiveAgentSessionSnapshotFixture({
            externalSessionId: "external-1",
            workingDirectory,
          }),
        ],
      ],
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        [
          "opencode",
          [
            createStdioRuntime("runtime-stdio-a", workingDirectory),
            createStdioRuntime("runtime-stdio-b", workingDirectory),
          ],
        ],
      ]),
      preloadedRuntimeConnections,
      preloadedLiveAgentSessionsByKey,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("planner", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBe("runtime-stdio-b");
    expect(result.runtimeConnection).toEqual(runtimeConnectionB);
    expect(result.runtimeRoute).toEqual({ type: "stdio", identity: "runtime-stdio-b" });
  });

  test("fails fast when duplicate live stdio runtimes share the same transport identity", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const runtimeConnection: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([runtimeConnection]);
    const preloadedLiveAgentSessionsByKey = new Map([
      [
        liveAgentSessionLookupKey("opencode", runtimeConnection, workingDirectory),
        [
          createLiveAgentSessionSnapshotFixture({
            externalSessionId: "external-1",
            workingDirectory,
          }),
        ],
      ],
    ]);

    const runtimeA = {
      ...createStdioRuntime("runtime-a", workingDirectory),
      runtimeRoute: { type: "stdio", identity: "runtime-stdio" } as const,
    };
    const runtimeB = {
      ...createStdioRuntime("runtime-b", workingDirectory),
      runtimeRoute: { type: "stdio", identity: "runtime-stdio" } as const,
    };

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [runtimeA, runtimeB]],
      ]),
      preloadedRuntimeConnections,
      preloadedLiveAgentSessionsByKey,
      ensureWorkspaceRuntime: async () => null,
    });

    await expect(
      resolveHydrationRuntime(createRecord("planner", workingDirectory)),
    ).resolves.toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: `Multiple live stdio runtimes share transport identity stdio:runtime-stdio for working directory ${workingDirectory}.`,
    });
  });

  test("fails fast when multiple preloaded stdio connections match the same working directory", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnectionA: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-a",
      workingDirectory,
    };
    const preloadedRuntimeConnectionB: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-b",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([
      preloadedRuntimeConnectionA,
      preloadedRuntimeConnectionB,
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      ensureWorkspaceRuntime: async () => null,
    });

    await expect(
      resolveHydrationRuntime(createRecord("planner", workingDirectory)),
    ).resolves.toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: `Multiple preloaded runtime connections found for working directory ${workingDirectory}.`,
    });
  });

  test("uses preloaded snapshots to disambiguate same-directory preloaded stdio connections", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnectionA: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-a",
      workingDirectory,
    };
    const preloadedRuntimeConnectionB: AgentRuntimeConnection = {
      type: "stdio",
      identity: "runtime-stdio-b",
      workingDirectory,
    };
    const preloadedRuntimeConnections = createPreloadIndex([
      preloadedRuntimeConnectionA,
      preloadedRuntimeConnectionB,
    ]);
    const preloadedLiveAgentSessionsByKey = new Map([
      [
        liveAgentSessionLookupKey("opencode", preloadedRuntimeConnectionB, workingDirectory),
        [
          createLiveAgentSessionSnapshotFixture({
            externalSessionId: "external-1",
            workingDirectory,
          }),
        ],
      ],
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnections,
      preloadedLiveAgentSessionsByKey,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("planner", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBeNull();
    expect(result.runtimeConnection).toEqual(preloadedRuntimeConnectionB);
    expect(result.runtimeRoute).toEqual({ type: "stdio", identity: "runtime-stdio-b" });
  });

  test("includes the missing working directory when repo-root planner ensure cannot provide a runtime", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("planner", "/tmp/repo"));
    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live runtime found for working directory /tmp/repo.",
    });
    expect(ensureCalls).toBe(1);
  });
});

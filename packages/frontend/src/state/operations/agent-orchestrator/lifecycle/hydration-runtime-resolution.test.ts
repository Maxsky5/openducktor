import { describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection } from "@openducktor/core";
import { createHydrationRuntimeResolver } from "./hydration-runtime-resolution";
import { runtimeWorkingDirectoryKey } from "./live-agent-session-cache";

const createRecord = (
  role: AgentSessionRecord["role"],
  workingDirectory: string,
): AgentSessionRecord => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
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

describe("createHydrationRuntimeResolver", () => {
  test("prefers live runtime resolution over preloaded runtime connections", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const preloadedRuntimeConnectionsByKey = new Map<string, AgentRuntimeConnection>([
      [
        runtimeWorkingDirectoryKey("opencode", workingDirectory),
        {
          type: "local_http",
          endpoint: "http://127.0.0.1:9999",
          workingDirectory,
        },
      ],
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime(workingDirectory)]],
      ]),
      preloadedRuntimeConnectionsByKey,
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

  test("hydrates build sessions through a shared workspace runtime", async () => {
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
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBe("runtime-1");
    expect(result.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
    expect(result.runtimeConnection).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
      workingDirectory: "/tmp/openducktor-worktrees/task-1",
    });
    expect(ensureCalls).toBe(0);
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

  test("ensures a shared workspace runtime for build sessions on non-root directories", async () => {
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
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
    expect(result.runtimeConnection).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
      workingDirectory: "/tmp/other",
    });
    expect(ensureCalls).toBe(1);
  });

  test("falls back to preloaded runtime connection when no run or runtime exists", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnectionsByKey = new Map<string, AgentRuntimeConnection>([
      [
        runtimeWorkingDirectoryKey("opencode", workingDirectory),
        {
          type: "local_http",
          endpoint: "http://127.0.0.1:9999",
          workingDirectory,
        },
      ],
    ]);
    let ensureCalls = 0;

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnectionsByKey,
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

  test("preserves stdio preloaded runtime connections during hydration fallback", async () => {
    const workingDirectory = "/tmp/repo";
    const preloadedRuntimeConnectionsByKey = new Map<string, AgentRuntimeConnection>([
      [
        runtimeWorkingDirectoryKey("opencode", workingDirectory),
        {
          type: "stdio",
          identity: "runtime-stdio",
          workingDirectory,
        },
      ],
    ]);

    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnectionsByKey,
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

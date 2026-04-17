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
    expect(result.runId).toBeNull();
    expect(result.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
  });

  test("attaches build sessions from the shared workspace runtime when no run is present", async () => {
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime("/tmp/repo")]],
      ]),
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("build", "/tmp/repo/worktree"));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBe("runtime-1");
    expect(result.runId).toBeNull();
    expect(result.runtimeConnection).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
      workingDirectory: "/tmp/repo/worktree",
    });
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
    expect(result.runId).toBeNull();
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
    expect(result.runId).toBeNull();
    expect(result.runtimeConnection).toEqual({
      type: "stdio",
      workingDirectory,
    });
    expect(result.runtimeRoute).toEqual({
      type: "stdio",
    });
  });
});

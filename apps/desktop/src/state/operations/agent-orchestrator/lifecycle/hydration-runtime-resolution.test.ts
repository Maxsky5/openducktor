import { describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RunSummary,
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

const createRun = (workingDirectory: string): RunSummary => ({
  runId: "run-1",
  runtimeKind: "opencode",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  repoPath: "/tmp/repo",
  taskId: "task-1",
  branch: "obp/task-1",
  worktreePath: workingDirectory,
  port: 4444,
  state: "running",
  lastMessage: null,
  startedAt: "2026-03-01T10:00:00.000Z",
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
  test("prefers live run resolution over preloaded runtime connections", async () => {
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
      liveRuns: [createRun(workingDirectory)],
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      preloadedRuntimeConnectionsByKey,
      ensureWorkspaceRuntime: async () => null,
    });

    const result = await resolveHydrationRuntime(createRecord("build", workingDirectory));
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runId).toBe("run-1");
    expect(result.runtimeId).toBeNull();
    expect(result.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
    });
  });

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
      liveRuns: [],
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
      liveRuns: [],
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
});

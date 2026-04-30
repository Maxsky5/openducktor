import { describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import { createHydrationRuntimeResolver } from "./hydration-runtime-resolution";

const createRecord = (
  runtimeKind: AgentSessionRecord["runtimeKind"],
  role: AgentSessionRecord["role"],
  workingDirectory: string,
): AgentSessionRecord => ({
  runtimeKind,
  externalSessionId: "external-1",
  role,
  scenario: role === "qa" ? "qa_review" : "build_implementation_start",
  startedAt: "2026-03-01T10:00:00.000Z",
  workingDirectory,
  selectedModel: null,
});

const createRuntime = ({
  runtimeKind = "opencode",
  runtimeId = "runtime-1",
  repoPath = "/tmp/repo",
  workingDirectory = "/tmp/repo",
}: {
  runtimeKind?: RuntimeKind;
  runtimeId?: string;
  repoPath?: string;
  workingDirectory?: string;
} = {}): RuntimeInstanceSummary => ({
  kind: runtimeKind,
  runtimeId,
  repoPath,
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
  test("selects the live repo runtime for the persisted runtime kind", async () => {
    const record = createRecord("opencode", "planner", "/tmp/repo/worktree");
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        [
          "opencode",
          [
            createRuntime({ runtimeId: "wrong-repo-runtime", repoPath: "/tmp/other" }),
            createRuntime({ runtimeId: "repo-runtime", repoPath: "/tmp/repo" }),
          ],
        ],
      ]),
      ensureWorkspaceRuntime: async () => {
        throw new Error("ensureWorkspaceRuntime should not be called");
      },
    });

    const result = await resolveHydrationRuntime(record);

    expect(result).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "repo-runtime",
      workingDirectory: record.workingDirectory,
    });
  });

  test("uses the persisted runtime kind when resolving and returns the ensured runtime", async () => {
    const record = createRecord("custom-runtime", "planner", "/tmp/repo/worktree");
    let ensureCalls = 0;
    let receivedRuntimeKind: RuntimeKind | null = null;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["custom-runtime", []]]),
      ensureWorkspaceRuntime: async (runtimeKind) => {
        ensureCalls += 1;
        receivedRuntimeKind = runtimeKind;
        return createRuntime({
          runtimeKind,
          runtimeId: "ensured-runtime",
          repoPath: "/tmp/repo",
        });
      },
    });

    const result = await resolveHydrationRuntime(record);

    expect(result).toEqual({
      ok: true,
      runtimeKind: "custom-runtime",
      runtimeId: "ensured-runtime",
      workingDirectory: record.workingDirectory,
    });
    expect(ensureCalls).toBe(1);
    if (receivedRuntimeKind === null) {
      throw new Error("Expected the runtime resolver to receive the persisted runtime kind.");
    }
    expect(receivedRuntimeKind as string).toBe("custom-runtime");
  });

  test("returns an error when ensureWorkspaceRuntime cannot provide a runtime", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      ensureWorkspaceRuntime: async () => {
        ensureCalls += 1;
        return null;
      },
    });

    const result = await resolveHydrationRuntime(createRecord("opencode", "build", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live repo runtime found for repo /tmp/repo and runtime opencode.",
    });
    expect(ensureCalls).toBe(1);
  });

  test("fails fast when an ensured runtime belongs to a different repo", async () => {
    let ensureCalls = 0;
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
      ensureWorkspaceRuntime: async (runtimeKind) => {
        ensureCalls += 1;
        return createRuntime({
          runtimeKind,
          runtimeId: "wrong-repo-runtime",
          repoPath: "/tmp/other",
        });
      },
    });

    const result = await resolveHydrationRuntime(createRecord("opencode", "planner", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "Resolved runtime belongs to repo /tmp/other, not requested repo /tmp/repo.",
    });
    expect(ensureCalls).toBe(1);
  });

  test("passes through the record working directory", async () => {
    const record = createRecord("opencode", "planner", "/tmp/repo/worktree");
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime({ runtimeId: "repo-runtime", repoPath: "/tmp/repo" })]],
      ]),
      ensureWorkspaceRuntime: async () => {
        throw new Error("ensureWorkspaceRuntime should not be called");
      },
    });

    const result = await resolveHydrationRuntime(record);

    expect(result).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "repo-runtime",
      workingDirectory: "/tmp/repo/worktree",
    });
  });
});

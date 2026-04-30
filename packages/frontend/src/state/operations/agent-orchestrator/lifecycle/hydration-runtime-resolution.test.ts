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
    });

    const result = await resolveHydrationRuntime(record);

    expect(result).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "repo-runtime",
      workingDirectory: record.workingDirectory,
    });
  });

  test("returns an error when no live runtime exists for the persisted runtime kind", async () => {
    const record = createRecord("custom-runtime", "planner", "/tmp/repo/worktree");
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["custom-runtime", []]]),
    });

    const result = await resolveHydrationRuntime(record);

    expect(result).toEqual({
      ok: false,
      runtimeKind: "custom-runtime",
      reason: "No live repo runtime found for repo /tmp/repo and runtime custom-runtime.",
    });
  });

  test("returns an error when no runtime exists for the requested repo", async () => {
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([["opencode", []]]),
    });

    const result = await resolveHydrationRuntime(createRecord("opencode", "build", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live repo runtime found for repo /tmp/repo and runtime opencode.",
    });
  });

  test("returns an error when a runtime exists for a different repo", async () => {
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime({ runtimeId: "wrong-repo-runtime", repoPath: "/tmp/other" })]],
      ]),
    });

    const result = await resolveHydrationRuntime(createRecord("opencode", "planner", "/tmp/repo"));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "No live repo runtime found for repo /tmp/repo and runtime opencode.",
    });
  });

  test("passes through the record working directory", async () => {
    const record = createRecord("opencode", "planner", "/tmp/repo/worktree");
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
      runtimesByKind: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
        ["opencode", [createRuntime({ runtimeId: "repo-runtime", repoPath: "/tmp/repo" })]],
      ]),
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

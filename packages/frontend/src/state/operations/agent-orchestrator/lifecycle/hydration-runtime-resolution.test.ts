import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createHydrationRuntimeResolver } from "./hydration-runtime-resolution";

const createRecord = (
  runtimeKind: AgentSessionRecord["runtimeKind"],
  role: AgentSessionRecord["role"],
  workingDirectory: string,
): AgentSessionRecord => ({
  runtimeKind,
  externalSessionId: "external-1",
  role,
  startedAt: "2026-03-01T10:00:00.000Z",
  workingDirectory,
  selectedModel: null,
});

describe("createHydrationRuntimeResolver", () => {
  test("builds a logical repo runtime ref from persisted session metadata", async () => {
    const record = createRecord("opencode", "planner", "/tmp/repo/worktree");
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
    });

    const result = await resolveHydrationRuntime(record);

    expect(result).toEqual({
      ok: true,
      runtimeRef: {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
      },
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("normalizes equivalent repo and working-directory paths", async () => {
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo/",
    });

    const result = await resolveHydrationRuntime(
      createRecord("opencode", "build", "/tmp/repo/worktree/"),
    );

    expect(result).toEqual({
      ok: true,
      runtimeRef: {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
      },
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("returns an actionable error when persisted working directory is missing", async () => {
    const resolveHydrationRuntime = createHydrationRuntimeResolver({
      repoPath: "/tmp/repo",
    });

    const result = await resolveHydrationRuntime(createRecord("opencode", "build", "   "));

    expect(result).toEqual({
      ok: false,
      runtimeKind: "opencode",
      reason: "Cannot hydrate session external-1 without a working directory.",
    });
  });
});

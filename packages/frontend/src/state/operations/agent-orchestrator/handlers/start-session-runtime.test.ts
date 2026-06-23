import { describe, expect, test } from "bun:test";
import {
  resolveFreshStartTargetWorkingDirectoryForStart,
  serializeSelectedModelKey,
} from "./start-session-runtime";
import {
  createBuildContinuationTargetFixture,
  createRuntimeDependenciesFixture,
  createStartSessionContextFixture,
} from "./start-session-strategy-test-fixtures";

describe("agent-orchestrator/handlers/start-session-runtime", () => {
  test("normalizes explicit fresh-start target working directory", async () => {
    const result = await resolveFreshStartTargetWorkingDirectoryForStart({
      ctx: createStartSessionContextFixture(),
      runtime: createRuntimeDependenciesFixture({
        resolveTaskWorktree: async () => {
          throw new Error("should not resolve build target");
        },
      }),
      targetWorkingDirectory: "/tmp/repo/worktree/",
    });

    expect(result).toEqual({
      targetWorkingDirectory: "/tmp/repo/worktree/",
      normalizedTargetWorkingDirectory: "/tmp/repo/worktree",
    });
  });

  test("does not resolve task worktree for regular fresh build starts", async () => {
    let resolveTaskWorktreeCalls = 0;
    const result = await resolveFreshStartTargetWorkingDirectoryForStart({
      ctx: createStartSessionContextFixture(),
      runtime: createRuntimeDependenciesFixture({
        resolveTaskWorktree: async () => {
          resolveTaskWorktreeCalls += 1;
          return createBuildContinuationTargetFixture("/tmp/repo/worktree");
        },
      }),
    });

    expect(result).toEqual({
      targetWorkingDirectory: undefined,
      normalizedTargetWorkingDirectory: "",
    });
    expect(resolveTaskWorktreeCalls).toBe(0);
  });

  test("serializeSelectedModelKey stays stable across all model dimensions", () => {
    expect(
      serializeSelectedModelKey({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "build",
      }),
    ).toBe("opencode::openai::gpt-5::default::build");
  });

  test("returns the typed continuation target working directory for qa starts", async () => {
    await expect(
      resolveFreshStartTargetWorkingDirectoryForStart({
        ctx: createStartSessionContextFixture({ role: "qa" }),
        runtime: createRuntimeDependenciesFixture({
          resolveTaskWorktree: async () =>
            createBuildContinuationTargetFixture("/tmp/repo/worktree"),
        }),
      }),
    ).resolves.toEqual({
      targetWorkingDirectory: "/tmp/repo/worktree",
      normalizedTargetWorkingDirectory: "/tmp/repo/worktree",
    });
  });
});

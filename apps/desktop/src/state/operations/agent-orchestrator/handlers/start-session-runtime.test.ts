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
        resolveBuildContinuationTarget: async () => {
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

  test("maps missing build continuation target to null for fresh build starts", async () => {
    const result = await resolveFreshStartTargetWorkingDirectoryForStart({
      ctx: createStartSessionContextFixture(),
      runtime: createRuntimeDependenciesFixture({
        resolveBuildContinuationTarget: async () => null,
      }),
    });

    expect(result).toEqual({
      targetWorkingDirectory: null,
      normalizedTargetWorkingDirectory: "",
    });
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
          resolveBuildContinuationTarget: async () =>
            createBuildContinuationTargetFixture("/tmp/repo/worktree", "builder_session"),
        }),
      }),
    ).resolves.toEqual({
      targetWorkingDirectory: "/tmp/repo/worktree",
      normalizedTargetWorkingDirectory: "/tmp/repo/worktree",
    });
  });
});

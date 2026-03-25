import { describe, expect, test } from "bun:test";
import {
  resolveFreshStartTargetWorkingDirectoryForStart,
  serializeSelectedModelKey,
} from "./start-session-runtime";

describe("agent-orchestrator/handlers/start-session-runtime", () => {
  test("normalizes explicit fresh-start target working directory", async () => {
    const result = await resolveFreshStartTargetWorkingDirectoryForStart({
      ctx: {
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "build",
        isStaleRepoOperation: () => false,
      },
      runtime: {
        adapter: {
          stopSession: async () => undefined,
        } as never,
        ensureRuntime: async () => {
          throw new Error("should not resolve runtime");
        },
        resolveBuildContinuationTarget: async () => {
          throw new Error("should not resolve build target");
        },
      },
      targetWorkingDirectory: "/tmp/repo/worktree/",
    });

    expect(result).toEqual({
      targetWorkingDirectory: "/tmp/repo/worktree/",
      normalizedTargetWorkingDirectory: "/tmp/repo/worktree",
    });
  });

  test("maps missing build continuation target to null for fresh build starts", async () => {
    const result = await resolveFreshStartTargetWorkingDirectoryForStart({
      ctx: {
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "build",
        isStaleRepoOperation: () => false,
      },
      runtime: {
        adapter: {
          stopSession: async () => undefined,
        } as never,
        ensureRuntime: async () => {
          throw new Error("should not resolve runtime");
        },
        resolveBuildContinuationTarget: async () => {
          throw new Error("Builder continuation cannot start until a builder worktree exists");
        },
      },
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
});

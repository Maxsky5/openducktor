import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createDirectMergeGitPort,
} from "../test-support/task-workflow-harness";
import { appendTaskCleanupProgress, collectResetWorktreePaths } from "./task-cleanup-support";

describe("task cleanup support", () => {
  test("reports reset implementation cleanup progress with the narrow operation label", () => {
    const error = appendTaskCleanupProgress(new Error("delete branch failed"), {
      operation: "task_reset_implementation",
      removedWorktrees: ["/worktrees/repo/task-1"],
      deletedBranches: [],
    });

    expect(error).toBeInstanceOf(HostOperationError);
    expect((error as HostOperationError).operation).toBe("task_reset_implementation.cleanup");
    expect((error as Error).message).toContain(
      "Reset implementation cleanup already removed worktrees: /worktrees/repo/task-1.",
    );
    expect((error as Error).message).toContain(
      "Retry reset implementation to finish cleanup safely.",
    );
  });

  test("keeps legacy implementation worktrees as reset cleanup targets without a canonical worktree", async () => {
    const legacyWorktree = "/legacy/repo/task-1";
    const worktreePaths = await Effect.runPromise(
      collectResetWorktreePaths(
        {
          gitPort: createDirectMergeGitPort({
            calls: [],
            currentBranches: {
              [legacyWorktree]: { name: "odt/task-1-legacy", detached: false },
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", legacyWorktree])),
        },
        "/repo",
        "/worktrees/repo",
        "odt",
        "task-1",
        [createAgentSessionRecord({ workingDirectory: legacyWorktree })],
        new Set(["build", "qa"]),
        "reset implementation",
      ),
    );

    expect(worktreePaths).toEqual([legacyWorktree]);
  });
});

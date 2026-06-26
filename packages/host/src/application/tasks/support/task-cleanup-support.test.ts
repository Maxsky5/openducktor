import { describe, expect, test } from "bun:test";
import { HostOperationError } from "../../../effect/host-errors";
import { appendTaskCleanupProgress } from "./task-cleanup-support";

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
});

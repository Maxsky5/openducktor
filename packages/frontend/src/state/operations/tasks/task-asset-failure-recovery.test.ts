import { describe, expect, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import {
  formatTaskAssetFailure,
  taskAssetFailureFromError,
  taskAssetFailureRequiresLock,
  taskAssetRecoveryRefreshStrategy,
} from "./task-asset-failure-recovery";

describe("task asset failure recovery", () => {
  test("retains structured partial-state details for task mutation recovery", () => {
    const error = new HostInvokeError("Task creation failed", {
      kind: "task_asset",
      taskAssetFailure: {
        operation: "create",
        code: "partial_state",
        taskId: "created-task",
        assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
        failedPhase: "compensate_create",
        durableState: "created_partial",
        retryAllowed: false,
        message: "Refresh before continuing.",
      },
    });

    const failure = taskAssetFailureFromError(error);
    expect(failure).not.toBeNull();
    expect(taskAssetFailureRequiresLock(failure)).toBe(true);
    expect(formatTaskAssetFailure(failure)).toContain("created-task");
    expect(formatTaskAssetFailure(failure)).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(formatTaskAssetFailure(failure)).toContain("compensate_create");
    expect(formatTaskAssetFailure(failure)).toContain("created_partial");
    expect(formatTaskAssetFailure(failure)).toContain("Retry: blocked until refresh");
  });

  test("maps partial asset states to generic refresh strategies", () => {
    expect(
      taskAssetRecoveryRefreshStrategy(
        {
          operation: "update",
          code: "partial_state",
          taskId: "task-1",
          assetIds: [],
          failedPhase: "cleanup",
          durableState: "committed_cleanup_pending",
          retryAllowed: false,
          message: "Cleanup pending",
        },
        { kind: "task", taskId: "task-1" },
      ),
    ).toEqual({ kind: "invalidate-task", taskId: "task-1" });
    expect(
      taskAssetRecoveryRefreshStrategy(
        {
          operation: "delete",
          code: "partial_state",
          taskId: "task-1",
          assetIds: [],
          failedPhase: "purge",
          durableState: "committed_cleanup_pending",
          retryAllowed: false,
          message: "Cleanup pending",
        },
        { kind: "remove-task", taskIds: ["task-1"] },
      ),
    ).toEqual({ kind: "remove-task", taskIds: ["task-1"] });
  });
});

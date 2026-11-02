import { describe, expect, test } from "bun:test";
import type { TaskMergeStatus } from "@openducktor/contracts";
import { buildAutoCloseFailures, taskMergeCheckResultText } from "./task-merge-status";

const status = (overrides: Partial<TaskMergeStatus> = {}): TaskMergeStatus => ({
  taskId: "task-1",
  branch: "odt/task-1",
  targetBranch: { remote: "origin", branch: "main" },
  result: { kind: "merged", checkedAt: "2026-10-27T10:00:00.000Z", branchOid: "abc" },
  ...overrides,
});

describe("taskMergeCheckResultText", () => {
  test("counts the merged task branches", () => {
    expect(
      taskMergeCheckResultText({
        workspaceId: "workspace-1",
        repoPath: "/repo",
        tasks: [],
        autoCloseFailures: [],
      }),
    ).toBe("No task branch is merged.");
    expect(
      taskMergeCheckResultText({
        workspaceId: "workspace-1",
        repoPath: "/repo",
        autoCloseFailures: [],
        tasks: [status(), status({ taskId: "t2" })],
      }),
    ).toBe("2 task branches are merged. Close the tasks from the board.");
  });

  test("counts the failed checks", () => {
    const failed = status({
      taskId: "task-2",
      result: { kind: "not_checked" },
      failure: { message: "Git failed.", failedAt: "2026-10-27T10:00:00.000Z" },
    });

    expect(
      taskMergeCheckResultText({
        workspaceId: "workspace-1",
        repoPath: "/repo",
        autoCloseFailures: [],
        tasks: [status(), failed],
      }),
    ).toBe("1 task branch is merged. Close the task from the board. 1 check failed.");
  });
});

describe("buildAutoCloseFailures", () => {
  test("shows the failure only for a task that can still close", () => {
    const failure = (taskId: string) => ({
      taskId,
      message: "Archive the chat first.",
      failedAt: "2026-11-03T10:00:00.000Z",
    });

    const failures = buildAutoCloseFailures(
      [
        { id: "open", availableActions: ["close_task"] },
        { id: "closed", availableActions: [] },
      ],
      {
        workspaceId: "workspace-1",
        repoPath: "/repo",
        tasks: [],
        autoCloseFailures: [failure("open"), failure("closed"), failure("unknown")],
      },
    );

    expect([...failures]).toEqual([
      ["open", "Pull request merged, but the task did not close. Archive the chat first."],
    ]);
  });
});

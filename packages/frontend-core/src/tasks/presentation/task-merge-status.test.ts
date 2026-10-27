import { describe, expect, test } from "bun:test";
import type { TaskMergeStatus } from "@openducktor/contracts";
import { taskMergeCheckResultText } from "./task-merge-status";

const status = (overrides: Partial<TaskMergeStatus> = {}): TaskMergeStatus => ({
  taskId: "task-1",
  branch: "odt/task-1",
  targetBranch: { remote: "origin", branch: "main" },
  result: { kind: "merged", checkedAt: "2026-10-27T10:00:00.000Z", branchOid: "abc" },
  ...overrides,
});

describe("taskMergeCheckResultText", () => {
  test("counts the merged task branches", () => {
    expect(taskMergeCheckResultText({ repoPath: "/repo", tasks: [] })).toBe(
      "No task branch is merged.",
    );
    expect(
      taskMergeCheckResultText({ repoPath: "/repo", tasks: [status(), status({ taskId: "t2" })] }),
    ).toBe("2 task branches are merged. Close the tasks from the board.");
  });

  test("counts the failed checks", () => {
    const failed = status({
      taskId: "task-2",
      result: { kind: "not_checked" },
      failure: { message: "Git failed.", failedAt: "2026-10-27T10:00:00.000Z" },
    });

    expect(taskMergeCheckResultText({ repoPath: "/repo", tasks: [status(), failed] })).toBe(
      "1 task branch is merged. Close the task from the board. 1 check failed.",
    );
  });
});

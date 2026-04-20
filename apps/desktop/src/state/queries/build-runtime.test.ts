import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { taskWorktreeQueryKeys, taskWorktreeQueryOptions } from "./build-runtime";

describe("build runtime queries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  test("uses a repo and task scoped query key for task worktrees", () => {
    expect(taskWorktreeQueryKeys.taskWorktree("/repo", "task-24")).toEqual([
      "task-worktree",
      "/repo",
      "task-24",
    ]);
  });

  test("taskWorktreeQueryOptions loads the canonical working directory", async () => {
    const taskWorktreeGet = mock(
      async (): Promise<TaskWorktreeSummary> => ({
        workingDirectory: "/repo/.worktrees/task-24",
      }),
    );

    const result = await queryClient.fetchQuery(
      taskWorktreeQueryOptions("/repo", "task-24", {
        taskWorktreeGet,
      }),
    );

    expect(result).toEqual({
      workingDirectory: "/repo/.worktrees/task-24",
    });
    expect(taskWorktreeGet).toHaveBeenCalledWith("/repo", "task-24");
  });
});

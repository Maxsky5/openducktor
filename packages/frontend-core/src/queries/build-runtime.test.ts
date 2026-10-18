import { describe, expect, mock, test } from "bun:test";
import type { TaskWorktreeSummary } from "@openducktor/contracts";
import type { ScheduleTask } from "../lib/scheduling";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  TASK_WORKTREE_TIMEOUT_MS,
  taskWorktreeQueryKeys,
  taskWorktreeQueryOptions,
} from "./build-runtime";

describe("build runtime queries", () => {
  test("uses a repo and task scoped query key for task worktrees", () => {
    expect(taskWorktreeQueryKeys.taskWorktree({ repoPath: "/repo", taskId: "task-24" })).toEqual([
      "task-worktree",
      "/repo",
      "task-24",
    ]);
  });

  test("can key task worktrees by the task version that owns them", () => {
    expect(
      taskWorktreeQueryKeys.taskWorktree({
        repoPath: "/repo",
        taskId: "task-24",
        taskVersion: "2026-02-22T12:00:00.000Z",
      }),
    ).toEqual(["task-worktree", "/repo", "task-24", "2026-02-22T12:00:00.000Z"]);
  });

  test("taskWorktreeQueryOptions loads the canonical working directory", async () => {
    const taskWorktreeGet = mock(async (): Promise<TaskWorktreeSummary> => ({
      workingDirectory: "/repo/.worktrees/task-24",
    }));

    const { queryClient } = createTestClientConnection({ client: { taskWorktreeGet } });

    const result = await queryClient.fetchQuery(
      taskWorktreeQueryOptions({
        repoPath: "/repo",
        taskId: "task-24",
      }),
    );

    expect(result).toEqual({
      workingDirectory: "/repo/.worktrees/task-24",
    });
    expect(taskWorktreeGet).toHaveBeenCalledWith("/repo", "task-24");
  });

  test("taskWorktreeQueryOptions includes the task version in its query key", () => {
    const options = taskWorktreeQueryOptions({
      repoPath: "/repo",
      taskId: "task-24",
      taskVersion: "2026-02-22T12:00:00.000Z",
    });

    expect([...options.queryKey]).toEqual([
      "task-worktree",
      "/repo",
      "task-24",
      "2026-02-22T12:00:00.000Z",
    ]);
  });

  test("taskWorktreeQueryOptions times out unresolved worktree reads", async () => {
    const taskWorktreeGet = mock(async (): Promise<TaskWorktreeSummary> => {
      await new Promise(() => {});
      return { workingDirectory: "/repo/.worktrees/task-24" };
    });
    const scheduleTask = mock<ScheduleTask>((callback, _delayMs) => {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          callback();
        }
      });
      return () => {
        cancelled = true;
      };
    });

    const { queryClient } = createTestClientConnection({ client: { taskWorktreeGet } });

    await expect(
      queryClient.fetchQuery(
        taskWorktreeQueryOptions({
          repoPath: "/repo",
          taskId: "task-24",
          scheduleTask,
        }),
      ),
    ).rejects.toThrow(`Timed out after ${TASK_WORKTREE_TIMEOUT_MS}ms while loading task worktree.`);
    expect(scheduleTask).toHaveBeenCalledWith(expect.any(Function), TASK_WORKTREE_TIMEOUT_MS);
  });
});

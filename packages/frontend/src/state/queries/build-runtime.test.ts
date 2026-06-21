import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  TASK_WORKTREE_TIMEOUT_MS,
  taskWorktreeQueryKeys,
  taskWorktreeQueryOptions,
} from "./build-runtime";

describe("build runtime queries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

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
    const taskWorktreeGet = mock(
      async (): Promise<TaskWorktreeSummary> => ({
        workingDirectory: "/repo/.worktrees/task-24",
      }),
    );

    const result = await queryClient.fetchQuery(
      taskWorktreeQueryOptions({
        repoPath: "/repo",
        taskId: "task-24",
        hostClient: {
          taskWorktreeGet,
        },
      }),
    );

    expect(result).toEqual({
      workingDirectory: "/repo/.worktrees/task-24",
    });
    expect(taskWorktreeGet).toHaveBeenCalledWith("/repo", "task-24");
  });

  test("taskWorktreeQueryOptions includes the task version in its query key", () => {
    const taskWorktreeGet = mock(async (): Promise<TaskWorktreeSummary | null> => null);

    const options = taskWorktreeQueryOptions({
      repoPath: "/repo",
      taskId: "task-24",
      taskVersion: "2026-02-22T12:00:00.000Z",
      hostClient: {
        taskWorktreeGet,
      },
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
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const setTimeoutMock = mock((handler: TimerHandler, _delay?: number) => {
      if (typeof handler !== "function") {
        throw new Error("Expected timeout callback function");
      }
      return originalSetTimeout(() => {
        handler();
      }, 0);
    });
    const clearTimeoutMock = mock((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
      originalClearTimeout(timeoutId);
    });

    globalThis.setTimeout = setTimeoutMock as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = clearTimeoutMock as unknown as typeof globalThis.clearTimeout;

    try {
      await expect(
        queryClient.fetchQuery(
          taskWorktreeQueryOptions({
            repoPath: "/repo",
            taskId: "task-24",
            hostClient: {
              taskWorktreeGet,
            },
          }),
        ),
      ).rejects.toThrow(
        `Timed out after ${TASK_WORKTREE_TIMEOUT_MS}ms while loading task worktree.`,
      );
      expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), TASK_WORKTREE_TIMEOUT_MS);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

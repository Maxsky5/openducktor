import type { TaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createTaskWorktreeCommandHandlers } from "./task-worktree-command-handlers";

describe("createTaskWorktreeCommandHandlers", () => {
  test("routes task_worktree_get to the service", async () => {
    const calls: unknown[] = [];
    const service: TaskWorktreeService = {
      async getTaskWorktree(input) {
        calls.push(input);
        return { workingDirectory: "/worktrees/task-1" };
      },
    };
    const router = createHostCommandRouter({
      handlers: createTaskWorktreeCommandHandlers(service),
    });

    await expect(
      router.invoke("task_worktree_get", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toEqual({
      workingDirectory: "/worktrees/task-1",
    });
    expect(calls).toEqual([{ repoPath: "/repo", taskId: "task-1" }]);
  });

  test("rejects malformed command inputs before calling the service", async () => {
    const calls: unknown[] = [];
    const service: TaskWorktreeService = {
      async getTaskWorktree(input) {
        calls.push(input);
        throw new Error("unexpected call");
      },
    };
    const router = createHostCommandRouter({
      handlers: createTaskWorktreeCommandHandlers(service),
    });

    await expect(router.invoke("task_worktree_get", { repoPath: "/repo" })).rejects.toThrow(
      "taskId is required.",
    );
    await expect(router.invoke("task_worktree_get")).rejects.toThrow(
      "task_worktree_get input must be an object.",
    );
    expect(calls).toEqual([]);
  });
});

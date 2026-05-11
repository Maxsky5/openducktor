import { createHostCommandRouter } from "./host-command-router";
import { createTaskWorktreeCommandHandlers } from "./task-worktree-command-handlers";
import type { TaskWorktreeService } from "./task-worktree-service";

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
});

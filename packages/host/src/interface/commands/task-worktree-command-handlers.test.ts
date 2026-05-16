import { Effect } from "effect";
import type { TaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createTaskWorktreeCommandHandlers } from "./task-worktree-command-handlers";

const createTaskWorktreeServiceFake = (service: TaskWorktreeService): TaskWorktreeService =>
  service as TaskWorktreeService;
describe("createTaskWorktreeCommandHandlers", () => {
  test("routes task_worktree_get to the service", async () => {
    const calls: unknown[] = [];
    const service = createTaskWorktreeServiceFake({
      getTaskWorktree(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return { workingDirectory: "/worktrees/task-1" };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
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
    const service = createTaskWorktreeServiceFake({
      getTaskWorktree(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
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

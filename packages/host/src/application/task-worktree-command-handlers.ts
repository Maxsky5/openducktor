import type { HostCommandHandlers } from "./host-command-router";
import type { TaskWorktreeService } from "./task-worktree-service";

export const createTaskWorktreeCommandHandlers = (
  taskWorktreeService: TaskWorktreeService,
): HostCommandHandlers => ({
  task_worktree_get: (args) => taskWorktreeService.getTaskWorktree(args),
});

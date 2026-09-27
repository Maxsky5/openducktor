import { HostValidationError } from "../../../effect/host-errors";

export const taskWorktreeIdError = (taskId: string): HostValidationError | null => {
  if (taskId && taskId !== "." && taskId !== ".." && !/[\\/:\0]/.test(taskId)) return null;
  return new HostValidationError({
    field: "taskId",
    message: "Task ID must name one worktree directory. Select a task and retry.",
  });
};

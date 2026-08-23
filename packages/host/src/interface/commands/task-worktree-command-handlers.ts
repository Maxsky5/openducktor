import type {
  TaskWorktreeInput,
  TaskWorktreeService,
} from "../../application/tasks/worktrees/task-worktree-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const parseTaskWorktreeInput = (args: Record<string, unknown> | undefined): TaskWorktreeInput => {
  const record = requireRecord(args, "task_worktree_get input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
  };
};

export const createTaskWorktreeCommandHandlers = (
  taskWorktreeService: TaskWorktreeService,
): HostCommandHandlers => ({
  task_worktree_get: (args) => taskWorktreeService.getTaskWorktree(parseTaskWorktreeInput(args)),
});

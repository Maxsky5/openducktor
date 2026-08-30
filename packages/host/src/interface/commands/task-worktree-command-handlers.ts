import type {
  TaskWorktreeInput,
  TaskWorktreeService,
} from "../../application/tasks/worktrees/task-worktree-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseTaskWorktreeInput = (args: HostCommandArgs): TaskWorktreeInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), "task_worktree_get input");
  return {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
    taskId: requireString(commandInputStringSchema.safeParse(record.taskId), "taskId"),
  };
};

export const createTaskWorktreeCommandHandlers = (taskWorktreeService: TaskWorktreeService) =>
  ({
    task_worktree_get: (args) => taskWorktreeService.getTaskWorktree(parseTaskWorktreeInput(args)),
  }) satisfies HostCommandHandlerDefinitions;

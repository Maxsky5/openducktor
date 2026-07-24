import type { TaskChangeSet } from "@openducktor/contracts";
import { Data } from "effect";
import type { TaskServiceError } from "./task-service";

export class TaskMutationProgressFailure extends Data.TaggedError("TaskMutationProgressFailure")<{
  readonly operation:
    | "build-completed"
    | "direct-merge"
    | "link-merged-pull-request"
    | "reset-implementation"
    | "reset-task"
    | "set-plan"
    | "set-spec"
    | "repo-pull-request-sync";
  readonly changes: TaskChangeSet;
  readonly failure: TaskServiceError;
}> {}

export const createTaskMutationProgressFailure = (
  operation: TaskMutationProgressFailure["operation"],
  taskId: string,
  failure: TaskMutationProgressFailure["failure"],
): TaskMutationProgressFailure =>
  new TaskMutationProgressFailure({
    operation,
    changes: { taskIds: [taskId], removedTaskIds: [] },
    failure,
  });

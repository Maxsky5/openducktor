import type {
  TaskChangeSet,
  TaskEventTaskSnapshot,
  TaskArtifactChange,
} from "@openducktor/contracts";
import { Data } from "effect";
import type { TaskServiceError } from "./task-service";

export class TaskMutationProgressFailure extends Data.TaggedError("TaskMutationProgressFailure")<{
  readonly operation:
    | "build-completed"
    | "create-task"
    | "delete-task"
    | "direct-merge"
    | "complete-direct-merge"
    | "link-merged-pull-request"
    | "reset-implementation"
    | "reset-task"
    | "update-task"
    | "repo-pull-request-sync";
  readonly changes: TaskChangeSet;
  readonly failure: TaskServiceError;
  readonly artifactChanges?: TaskArtifactChange[];
}> {}

export const createTaskMutationProgressFailure = (
  operation: TaskMutationProgressFailure["operation"],
  taskId: string,
  failure: TaskMutationProgressFailure["failure"],
  artifactChanges: TaskArtifactChange[] = [],
): TaskMutationProgressFailure =>
  new TaskMutationProgressFailure({
    operation,
    changes: { taskIds: [taskId], removedTaskIds: [] },
    failure,
    artifactChanges,
  });

export class TaskCreationProgressFailure extends TaskMutationProgressFailure {
  readonly createdTask: TaskEventTaskSnapshot;

  constructor(createdTask: TaskEventTaskSnapshot, failure: TaskServiceError) {
    super({
      operation: "create-task",
      changes: { taskIds: [createdTask.id], removedTaskIds: [] },
      failure,
    });
    this.createdTask = createdTask;
  }
}

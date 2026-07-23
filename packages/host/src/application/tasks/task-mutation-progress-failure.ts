import type { TaskChangeSet } from "@openducktor/contracts";
import { Data } from "effect";
import type { TaskServiceError } from "./task-service";

export class TaskMutationProgressFailure extends Data.TaggedError("TaskMutationProgressFailure")<{
  readonly operation: "set-plan" | "set-spec" | "repo-pull-request-sync";
  readonly changes: TaskChangeSet;
  readonly failure: TaskServiceError;
}> {}

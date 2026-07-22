import { Data } from "effect";
import type { TaskServiceError } from "./task-service";

/** Transient replacement progress for cache invalidation after planned subtask removals. */
export class SetPlanProgressFailure extends Data.TaggedError("SetPlanProgressFailure")<{
  readonly affectedTaskIds: string[];
  readonly failure: TaskServiceError;
}> {}

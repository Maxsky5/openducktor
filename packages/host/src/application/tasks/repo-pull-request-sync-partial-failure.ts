import { Data } from "effect";
import type { TaskServiceError } from "./task-service";

/** Transient progress for cache invalidation when pull-request sync partially persisted. */
export class RepoPullRequestSyncPartialFailure extends Data.TaggedError(
  "RepoPullRequestSyncPartialFailure",
)<{
  readonly changedTaskIds: string[];
  readonly failure: TaskServiceError;
}> {}

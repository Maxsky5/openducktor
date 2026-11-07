import type { DirectMergeRecord } from "@openducktor/contracts";
import { taskWaitsForMergePublication } from "@openducktor/workflows";
import { Effect, Result } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskRecord, TaskStorePort } from "../../../ports/task-repository-ports";
import type { TaskIdInput } from "../task-inputs";

type DirectMergeBlockedOperation =
  | "direct_merge"
  | "detect_pull_request"
  | "link_pull_request"
  | "upsert_pull_request"
  | "link_merged_pull_request";

type DirectMergeBlockDetails = { repoPath: string; taskId: string };

/** A recorded local direct merge blocks other review and publication paths. */
export const ensureNoDirectMergeEffect = ({
  operation,
  repoPath,
  taskId,
  directMerge,
}: {
  operation: DirectMergeBlockedOperation;
  repoPath: string;
  taskId: string;
  directMerge: DirectMergeRecord | undefined;
}): Effect.Effect<void, HostValidationError<DirectMergeBlockDetails>> =>
  directMerge === undefined
    ? Effect.void
    : Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: directMergeBlockReason(operation, taskId),
          details: { repoPath, taskId },
        }),
      );

const directMergeBlockReason = (operation: DirectMergeBlockedOperation, taskId: string): string => {
  switch (operation) {
    case "direct_merge":
      return `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before trying again.`;
    case "link_pull_request":
      return `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a pull request.`;
    case "upsert_pull_request":
      return `A local direct merge is already recorded for task ${taskId}. Finish or discard that direct merge workflow before opening a pull request.`;
    case "detect_pull_request":
    case "link_merged_pull_request":
      return `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`;
  }
};

/**
 * A local direct merge waits for its publication until the publication closes the task. While it
 * waits, the host rejects workflow events and Reset Task. The publication, Close Task, and Reset
 * Implementation stay available.
 */
const unpublishedDirectMergeError = (repoPath: string, taskId: string) =>
  new HostValidationError<DirectMergeBlockDetails>({
    field: "taskId",
    message: `Task ${taskId} has a local direct merge that is not published. Publish the merge or close the task in the approval dialog, or reset the implementation, then try again.`,
    details: { repoPath, taskId },
  });

const waitsForPublication = (directMerge: DirectMergeRecord | undefined, status: string) =>
  taskWaitsForMergePublication({ directMerge, status });

/**
 * Adds the unpublished direct merge check to a workflow event decision. The store runs the
 * decision on the locked task row, so the check reads the current status.
 */
export const blockUnpublishedDirectMerge =
  <Success, Failure>(
    directMerge: DirectMergeRecord | undefined,
    repoPath: string,
    decide: (current: TaskRecord) => Result.Result<Success, Failure>,
  ) =>
  (
    current: TaskRecord,
  ): Result.Result<Success, Failure | HostValidationError<DirectMergeBlockDetails>> =>
    waitsForPublication(directMerge, current.status)
      ? Result.fail(unpublishedDirectMergeError(repoPath, current.id))
      : decide(current);

/** Fails while a local direct merge of the task waits for its publication. */
export const requireNoUnpublishedDirectMerge = (
  taskStore: Pick<TaskStorePort, "getTaskDelivery">,
  input: TaskIdInput,
  status: string,
) =>
  Effect.gen(function* () {
    const { directMerge } = yield* taskStore.getTaskDelivery(input);
    if (waitsForPublication(directMerge, status))
      return yield* unpublishedDirectMergeError(input.repoPath, input.taskId);
  });

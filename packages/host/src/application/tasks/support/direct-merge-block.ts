import type { DirectMergeRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";

type DirectMergeBlockedOperation =
  | "human_request_changes"
  | "direct_merge"
  | "detect_pull_request"
  | "link_pull_request"
  | "upsert_pull_request"
  | "link_merged_pull_request";

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
}): Effect.Effect<void, HostValidationError<{ repoPath: string; taskId: string }>> =>
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
    case "human_request_changes":
      return `Cannot request changes after a local direct merge has already been applied for task ${taskId}. Push and complete the direct merge workflow first, or manually revert the local merge before reopening the task.`;
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

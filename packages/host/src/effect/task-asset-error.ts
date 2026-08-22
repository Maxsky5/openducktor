import type { TaskAssetFailure } from "@openducktor/contracts";
import { Data } from "effect";

export class TaskAssetError extends Data.TaggedError("TaskAssetError")<
  TaskAssetFailure & { readonly cause?: unknown }
> {}

export const taskAssetValidationError = (
  message: string,
  assetIds: string[] = [],
  taskId?: string,
): TaskAssetError =>
  new TaskAssetError({
    operation: taskId ? "update" : "stage",
    code: "validation",
    ...(() => {
      if (taskId) {
        return { taskId };
      }
      return {};
    })(),
    assetIds,
    failedPhase: "validation",
    durableState: "unchanged",
    retryAllowed: true,
    message,
  });

export const taskAssetErrorToFailure = (error: TaskAssetError): TaskAssetFailure => ({
  operation: error.operation,
  code: error.code,
  ...(() => {
    if (error.taskId) {
      return { taskId: error.taskId };
    }
    return {};
  })(),
  assetIds: error.assetIds,
  failedPhase: error.failedPhase,
  durableState: error.durableState,
  retryAllowed: error.retryAllowed,
  message: error.message,
});

import type { TaskAssetFailure } from "@openducktor/contracts";
import { Data } from "effect";

export class TaskAssetError extends Data.TaggedError("TaskAssetError")<
  TaskAssetFailure & { readonly cause?: unknown }
> {}

export const taskAssetValidationError = (
  message: string,
  assetIds: string[] = [],
  taskId?: string,
): TaskAssetError => {
  const fields = {
    operation: taskId ? "update" : "stage",
    code: "validation",
    assetIds,
    failedPhase: "validation",
    durableState: "unchanged",
    retryAllowed: true,
    message,
  } satisfies Omit<TaskAssetFailure, "taskId">;
  return taskId ? new TaskAssetError({ ...fields, taskId }) : new TaskAssetError(fields);
};

export const taskAssetErrorToFailure = (error: TaskAssetError): TaskAssetFailure => {
  const failure: TaskAssetFailure = {
    operation: error.operation,
    code: error.code,
    assetIds: error.assetIds,
    failedPhase: error.failedPhase,
    durableState: error.durableState,
    retryAllowed: error.retryAllowed,
    message: error.message,
  };
  if (error.taskId) {
    failure.taskId = error.taskId;
  }
  return failure;
};

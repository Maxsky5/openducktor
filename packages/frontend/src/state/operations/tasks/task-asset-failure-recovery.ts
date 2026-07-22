import type { TaskAssetFailure } from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";

export const taskAssetFailureFromError = (error: unknown): TaskAssetFailure | null => {
  if (error instanceof HostInvokeError && error.failure?.kind === "task_asset") {
    return error.failure.taskAssetFailure;
  }
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const failure = taskAssetFailureFromError(nested);
      if (failure) {
        return failure;
      }
    }
  }
  return null;
};

export const taskAssetFailureRequiresLock = (failure: TaskAssetFailure | null): boolean =>
  failure !== null && (!failure.retryAllowed || failure.durableState !== "unchanged");

export const formatTaskAssetFailure = (failure: TaskAssetFailure | null): string => {
  if (!failure) {
    return "Task asset recovery failed.";
  }
  const details = [
    failure.taskId ? `Task: ${failure.taskId}` : null,
    failure.assetIds.length > 0 ? `Assets: ${failure.assetIds.join(", ")}` : null,
    `Phase: ${failure.failedPhase}`,
    `Durable state: ${failure.durableState}`,
    failure.retryAllowed ? "Retry: allowed" : "Retry: blocked until refresh",
  ].filter((detail): detail is string => detail !== null);
  return `${failure.message} ${details.join(" · ")}`;
};

import type { ScheduleTask } from "@/lib/scheduling";

const HOST_RUNTIME_STATUS_TIMEOUT_MS = 15_000;

export const withRuntimeStatusTimeout = async <T>(
  request: () => Promise<T>,
  operation: "reading runtime status" | "subscribing to runtime changes",
  signal: AbortSignal,
  scheduler: ScheduleTask,
): Promise<T> => {
  if (signal.aborted) throw signal.reason;
  const deadline = Promise.withResolvers<never>();
  const cancelTimeout = scheduler(() => {
    deadline.reject(
      new Error(
        `Timed out after ${HOST_RUNTIME_STATUS_TIMEOUT_MS}ms while ${operation}. Check the host connection, then refresh runtime status.`,
      ),
    );
  }, HOST_RUNTIME_STATUS_TIMEOUT_MS);
  const onAbort = () => deadline.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([request(), deadline.promise]);
  } finally {
    cancelTimeout();
    signal.removeEventListener("abort", onAbort);
  }
};

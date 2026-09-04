import type { QueryClient } from "@tanstack/react-query";

const pendingWrites = new WeakMap<QueryClient, Promise<unknown>>();

/**
 * Wait for both the host write and its cache update before starting the next write.
 * A failed write still rejects its caller but does not block later writes.
 */
export function runSettingsWrite<T>(queryClient: QueryClient, write: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(queryClient) ?? Promise.resolve();
  const result = previous.then(write, write);
  pendingWrites.set(queryClient, result);
  const release = () => {
    if (pendingWrites.get(queryClient) === result) pendingWrites.delete(queryClient);
  };
  void result.then(release, release);
  return result;
}

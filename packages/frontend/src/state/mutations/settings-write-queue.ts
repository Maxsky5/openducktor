import type { QueryClient } from "@tanstack/react-query";

const pendingWrites = new WeakMap<QueryClient, Promise<unknown>>();

/** Keep a host write and its cache publication together, even when responses are delayed. */
export function runSettingsWrite<T>(queryClient: QueryClient, write: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(queryClient) ?? Promise.resolve();
  const result = previous.then(write, write);
  pendingWrites.set(queryClient, result);
  const release = () => {
    if (pendingWrites.get(queryClient) === result) pendingWrites.delete(queryClient);
  };
  // Each caller receives its original rejection; a failed write must not block the queue.
  void result.then(release, release);
  return result;
}

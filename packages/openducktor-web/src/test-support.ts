import type { RemoteHostClient } from "@openducktor/host-client/remote";

export const createFetchFixture = (
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch => Object.assign(implementation, { preconnect() {} });

export const waitForRemoteConnection = (
  connection: Pick<RemoteHostClient, "subscribeState">,
): Promise<void> => {
  const ready = Promise.withResolvers<void>();
  const stop = connection.subscribeState(({ status, failure }) => {
    if (status === "connected") ready.resolve();
    if (status === "failed") ready.reject(new Error(failure?.message));
  });
  return ready.promise.finally(stop);
};

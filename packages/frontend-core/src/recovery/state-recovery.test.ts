import { expect, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import { remoteError } from "@openducktor/host-client/remote";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { synchronizeConnectionState } from "./state-recovery";

test("host recovery refetches active host reads and skips reads marked to skip it", async () => {
  const queryClient = new QueryClient();
  const reads = { host: 0, device: 0 };
  const observe = (key: "host" | "device") =>
    new QueryObserver(queryClient, {
      queryKey: [key],
      queryFn: async () => ++reads[key],
      staleTime: Infinity,
      ...(key === "device" && { meta: { skipHostRecovery: true as const } }),
    }).subscribe(() => {});
  const stops = [observe("host"), observe("device")];
  try {
    await queryClient.refetchQueries();
    expect(reads).toEqual({ host: 1, device: 1 });

    await synchronizeConnectionState(queryClient, [], true);

    expect(reads).toEqual({ host: 2, device: 1 });
    expect(queryClient.getQueryState(["device"])?.isInvalidated).toBe(false);
  } finally {
    for (const stop of stops) stop();
    queryClient.clear();
  }
});

test("recovery reads again a query whose first read waits for the reconnect", async () => {
  const queryClient = new QueryClient();
  let calls = 0;
  let releaseWaitingRead = (): void => {};
  const stop = new QueryObserver(queryClient, {
    queryKey: ["first-read"],
    queryFn: () => {
      calls += 1;
      // The first read started while the host was away, so it waits for the end of recovery.
      if (calls === 1)
        return new Promise<string>((resolve) => {
          releaseWaitingRead = () => resolve("late");
        });
      return Promise.resolve("recovered");
    },
    staleTime: Infinity,
  }).subscribe(() => {});
  try {
    await synchronizeConnectionState(queryClient, [], true);

    expect(calls).toBe(2);
    expect(queryClient.getQueryData(["first-read"])).toBe("recovered");
  } finally {
    releaseWaitingRead();
    stop();
    queryClient.clear();
  }
});

const observeFailing = (queryClient: QueryClient, error: Error) =>
  new QueryObserver(queryClient, {
    queryKey: ["failing"],
    queryFn: async (): Promise<number> => {
      throw error;
    },
    retry: false,
    staleTime: Infinity,
  }).subscribe(() => {});

test("a host error of one read leaves the recovery to that read's view", async () => {
  const queryClient = new QueryClient();
  const stop = observeFailing(queryClient, new HostInvokeError("The runtime is starting.", null));
  try {
    await expect(synchronizeConnectionState(queryClient, [], true)).resolves.toBeUndefined();
    expect(queryClient.getQueryState(["failing"])?.status).toBe("error");
  } finally {
    stop();
    queryClient.clear();
  }
});

test("a lost connection during a recovery read fails the recovery", async () => {
  const queryClient = new QueryClient();
  const lost = remoteError("transport_failure", "The socket closed.", "Reconnect.");
  const stop = observeFailing(queryClient, lost);
  try {
    await expect(synchronizeConnectionState(queryClient, [], true)).rejects.toBe(lost);
  } finally {
    stop();
    queryClient.clear();
  }
});

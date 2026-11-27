import { expect, test } from "bun:test";
import { HostUnreachableError } from "@openducktor/host-client";
import { remoteError } from "@openducktor/host-client/remote";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { createClientQueryClient } from "./client-query-client";
import { createHostConnectionStore } from "./host-connection-state";
import { followHostConnection } from "./query-online-state";

const followedClient = () => {
  const connection = createHostConnectionStore();
  const queryClient = createClientQueryClient();
  const release = followHostConnection(queryClient, connection);
  return {
    connection,
    queryClient,
    dispose: () => {
      release();
      queryClient.clear();
    },
  };
};

test("a read that loses the host keeps its data and continues after the reconnect", async () => {
  const { connection, queryClient, dispose } = followedClient();
  try {
    queryClient.setQueryData(["read"], "cached");
    let reads = 0;
    const read = queryClient.fetchQuery({
      queryKey: ["read"],
      staleTime: 0,
      queryFn: async () => {
        reads += 1;
        if (reads > 1) return "fresh";
        // The transport reports the lost connection before the read fails.
        connection.setState("reconnecting");
        throw new HostUnreachableError(new TypeError("Failed to fetch"));
      },
    });
    // The first retry waits one second, then pauses while the host is unreachable.
    await Bun.sleep(1_100);
    expect(queryClient.getQueryState(["read"])).toMatchObject({
      status: "success",
      fetchStatus: "paused",
      error: null,
    });
    expect(queryClient.getQueryData(["read"])).toBe("cached");

    connection.setState("connected");
    await expect(read).resolves.toBe("fresh");
  } finally {
    dispose();
  }
}, 3_000);

test("a connection failure while online and a command while offline fail at once", async () => {
  const { connection, queryClient, dispose } = followedClient();
  try {
    const mismatch = remoteError("invalid_protocol", "Version mismatch.", "Update the host.");
    await expect(
      queryClient.fetchQuery({
        queryKey: ["mismatch"],
        queryFn: async () => {
          throw mismatch;
        },
      }),
    ).rejects.toBe(mismatch);

    connection.setState("reconnecting");
    const lost = new HostUnreachableError(new TypeError("Failed to fetch"));
    const command = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw lost;
      },
    });
    await expect(command.execute(undefined)).rejects.toBe(lost);
  } finally {
    dispose();
  }
});

test("only the newest connection drives the online state", () => {
  const first = createHostConnectionStore("reconnecting");
  const releaseFirst = followHostConnection(new QueryClient(), first);
  expect(onlineManager.isOnline()).toBe(false);
  const second = createHostConnectionStore("reconnecting");
  const releaseSecond = followHostConnection(new QueryClient(), second);
  // The release of an older connection must not reset the state of the newer one.
  releaseFirst();
  expect(onlineManager.isOnline()).toBe(false);
  second.setState("connected");
  expect(onlineManager.isOnline()).toBe(true);
  second.setState("reconnecting");
  releaseSecond();
  expect(onlineManager.isOnline()).toBe(true);
});

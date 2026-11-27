import { expect, test } from "bun:test";
import { HostUnreachableError } from "@openducktor/host-client";
import { remoteError } from "@openducktor/host-client/remote";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { createClientQueryClient } from "./client-query-client";
import { createHostConnectionStore } from "./host-connection-state";
import { followHostConnection } from "./query-online-state";

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) await Bun.sleep(5);
  expect(condition()).toBe(true);
};

const waitForPause = (queryClient: QueryClient) =>
  waitFor(() => queryClient.getQueryState(["read"])?.fetchStatus === "paused");

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

const readOnce = (connection: ReturnType<typeof createHostConnectionStore>) => {
  let reads = 0;
  return async () => {
    reads += 1;
    if (reads > 1) return "fresh";
    // The transport reports the lost connection before the read fails.
    connection.setState("reconnecting");
    throw new HostUnreachableError(new TypeError("Failed to fetch"));
  };
};

test("a view read that loses the host keeps its data and continues after the reconnect", async () => {
  const { connection, queryClient, dispose } = followedClient();
  queryClient.setQueryData(["read"], "cached");
  const view = new QueryObserver(queryClient, {
    queryKey: ["read"],
    queryFn: readOnce(connection),
  });
  const stop = view.subscribe(() => {});
  try {
    const read = view.refetch();
    await waitForPause(queryClient);
    expect(queryClient.getQueryState(["read"])).toMatchObject({ status: "success", error: null });
    expect(queryClient.getQueryData(["read"])).toBe("cached");

    connection.setState("connected");
    await read;
    expect(queryClient.getQueryData(["read"])).toBe("fresh");
  } finally {
    stop();
    dispose();
  }
});

test("an awaited read fails at once when it loses the host, and the view keeps waiting", async () => {
  const { connection, queryClient, dispose } = followedClient();
  queryClient.setQueryData(["read"], "cached");
  const view = new QueryObserver(queryClient, {
    queryKey: ["read"],
    queryFn: readOnce(connection),
  });
  const stop = view.subscribe(() => {});
  try {
    // A command that checks this read first must not run after the reconnect.
    await expect(
      queryClient.fetchQuery({ queryKey: ["read"], queryFn: readOnce(connection), staleTime: 0 }),
    ).rejects.toBeInstanceOf(HostUnreachableError);
    expect(queryClient.getQueryState(["read"])).toMatchObject({
      status: "success",
      fetchStatus: "paused",
      error: null,
    });
    // A later awaited read fails at once too, and cached fresh data still answers.
    await expect(
      queryClient.fetchQuery({ queryKey: ["read"], queryFn: readOnce(connection), staleTime: 0 }),
    ).rejects.toBeInstanceOf(HostUnreachableError);
    await expect(
      queryClient.ensureQueryData({ queryKey: ["read"], queryFn: async () => "" }),
    ).resolves.toBe("cached");

    connection.setState("connected");
    await waitFor(() => queryClient.getQueryData(["read"]) === "fresh");
  } finally {
    stop();
    dispose();
  }
});

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

import { workspaceRefFixture } from "@openducktor/frontend-core/test-support/workspace-ref-fixture";
import { describe, expect, mock, spyOn, test } from "bun:test";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { createHostConnectionStore } from "@openducktor/frontend-core/connection/host-connection-state";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryObserver, useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createShellConnection, releaseShellConnection } from "./shell-connection";

const REMOTE_A = { kind: "remote", endpoint: "https://host-a.example.com" } as const;
const REMOTE_B = { kind: "remote", endpoint: "https://host-b.example.com" } as const;

describe("createShellConnection", () => {
  test("uses the selected bridge and query client, and page memory for a remote host", async () => {
    const workspaceStageLocalAttachment = mock(async () => ({ path: "/host/staged/image.png" }));
    const dispose = mock(async () => {});
    const bridge = createShellBridgeFixture({
      client: { workspaceStageLocalAttachment },
      bridge: { dispose },
    });
    const queryClient = createClientQueryClient();

    const connection = createShellConnection(bridge, queryClient, REMOTE_A);

    const identity = { workspaceId: "workspace-1", workspaceSessionId: "session-1" };
    connection.drafts.chat.set(identity, null, {
      segments: [{ id: "text-1", kind: "text", text: "Saved on this host" }],
    });
    await connection.drafts.chat.flush(identity);
    expect(connection.storage.length).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(connectionHost(queryClient)).toBe(bridge.client);
    await expect(
      connection.stageAttachment(new File(["image"], "image.png", { type: "image/png" })),
    ).resolves.toBe("/host/staged/image.png");
    expect(workspaceStageLocalAttachment).toHaveBeenCalledTimes(1);

    await connection.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => connectionHost(queryClient)).toThrow(
      "This query client has no open host connection.",
    );
  });

  test("keeps the layout storage of each remote host on this device after a reload", async () => {
    const connect = (target: Parameters<typeof createShellConnection>[2]) =>
      createShellConnection(createShellBridgeFixture(), createClientQueryClient(), target);
    const first = connect(REMOTE_A);
    try {
      first.layoutStorage.setItem("layout", "saved");
    } finally {
      await first.dispose();
    }
    try {
      const reloaded = connect(REMOTE_A);
      const otherHost = connect(REMOTE_B);
      try {
        expect(reloaded.layoutStorage.getItem("layout")).toBe("saved");
        expect(otherHost.layoutStorage.getItem("layout")).toBeNull();
        expect(otherHost.layoutStorage.length).toBe(0);
        // The local host does not see the keys of a remote host.
        expect(localStorage.getItem("layout")).toBeNull();
      } finally {
        await reloaded.dispose();
        await otherHost.dispose();
      }
    } finally {
      localStorage.clear();
    }
  });

  test.each([
    { target: { kind: "local" } as const, reads: 2 },
    { target: REMOTE_A, reads: 1 },
  ])(
    "a $target.kind host reads $reads time(s) after its connection recovers",
    async ({ target, reads }) => {
      const connectionState = createHostConnectionStore();
      const queryClient = createClientQueryClient();
      const connection = createShellConnection(
        createShellBridgeFixture({ bridge: { connectionState } }),
        queryClient,
        target,
      );
      let count = 0;
      const stop = new QueryObserver(queryClient, {
        queryKey: ["host-read"],
        queryFn: async () => ++count,
      }).subscribe(() => {});
      try {
        await queryClient.refetchQueries();
        connectionState.setState("reconnecting");
        connectionState.setState("connected");
        await queryClient.getQueryCache().find({ queryKey: ["host-read"] })?.promise;
        expect(count).toBe(reads);
      } finally {
        stop();
        await connection.dispose();
      }
    },
  );

  test("rejects a device file that is not a browser file", async () => {
    const connection = createShellConnection(
      createShellBridgeFixture(),
      createClientQueryClient(),
      { kind: "local" },
    );
    expect(connection.storage).toBe(localStorage);
    try {
      await expect(
        connection.stageAttachment({ name: "photo.heic", type: "image/heic", size: 4 }),
      ).rejects.toThrow('Attachment "photo.heic" is not a browser file.');
    } finally {
      await connection.dispose();
    }
  });
});

describe("releaseShellConnection", () => {
  test("stops the app subscriptions before the connection clears its state", async () => {
    let reads = 0;
    const connection = createTestClientConnection({
      client: {
        tasksList: async () => {
          reads += 1;
          return [];
        },
      },
    });
    const TaskReader = () => {
      useQuery(repoTaskDataQueryOptions(workspaceRefFixture("/repo")));
      return null;
    };
    const view = render(createElement(TaskReader), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(ClientConnectionProvider, { connection }, children),
    });
    await waitFor(() => expect(reads).toBe(1));
    const cache = connection.queryClient.getQueryCache();
    const observersAtDispose: number[] = [];
    const dispose = connection.dispose;
    spyOn(connection, "dispose").mockImplementation(() => {
      observersAtDispose.push(...cache.getAll().map((query) => query.getObserversCount()));
      return dispose();
    });

    await releaseShellConnection(connection, view.unmount);

    expect(observersAtDispose.length).toBeGreaterThan(0);
    expect(observersAtDispose.every((count) => count === 0)).toBe(true);
    expect(cache.getAll()).toEqual([]);
    expect(reads).toBe(1);
  });
});

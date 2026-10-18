import { describe, expect, mock, spyOn, test } from "bun:test";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createShellConnection, releaseShellConnection } from "./shell-connection";

describe("createShellConnection", () => {
  test("uses the selected bridge and query client, and page memory for a remote host", async () => {
    const workspaceStageLocalAttachment = mock(async () => ({ path: "/host/staged/image.png" }));
    const dispose = mock(async () => {});
    const bridge = createShellBridgeFixture({
      client: { workspaceStageLocalAttachment },
      bridge: { dispose },
    });
    const queryClient = createClientQueryClient();

    const connection = createShellConnection(bridge, queryClient, "remote");

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

  test("rejects a device file that is not a browser file", async () => {
    const connection = createShellConnection(
      createShellBridgeFixture(),
      createClientQueryClient(),
      "local",
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
      useQuery(repoTaskDataQueryOptions("/repo"));
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

    expect(observersAtDispose).toEqual([0]);
    expect(cache.getAll()).toEqual([]);
    expect(reads).toBe(1);
  });
});

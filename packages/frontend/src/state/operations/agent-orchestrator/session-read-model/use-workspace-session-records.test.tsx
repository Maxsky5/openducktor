import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type WorkspaceSessionUpdateListener,
} from "@/lib/shell-bridge";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { observeWorkspaceSessionRecords } from "@/state/queries/workspace-session-updates";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useWorkspaceSessionRecords } from "./use-workspace-session-records";

const record = (name: string): WorkspaceSession => ({
  id: "session-1",
  runtimeKind: "codex",
  externalSessionId: "native-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: name,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

describe("Workspace Session metadata subscription", () => {
  test("shares one native subscription with notifications until the last consumer leaves", async () => {
    const client = new QueryClient();
    let subscriptions = 0;
    let stops = 0;
    let emit!: WorkspaceSessionUpdateListener;
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceSessionListActive: async () => [record("Original")] },
        bridge: {
          subscribeWorkspaceSessionUpdates: async (listener) => {
            subscriptions += 1;
            emit = listener;
            return () => {
              stops += 1;
            };
          },
        },
      }),
    );
    const stopNotifications = observeWorkspaceSessionRecords(client, () => {});
    const harness = createHookHarness(() => useWorkspaceSessionRecords("A", client, 0), undefined);
    try {
      await harness.mount();
      await harness.waitFor((state) => state.records.isSuccess);
      expect(subscriptions).toBe(1);
      await harness.unmount();
      expect(stops).toBe(0);
      emit({ workspaceId: "A", session: record("Updated while inactive") });
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", false))?.[0]
          ?.manualTitle,
      ).toBe("Updated while inactive");
    } finally {
      stopNotifications();
      client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
    expect(stops).toBe(1);
  });

  test("clears an opening failure when Retry establishes a subscription without an initial event", async () => {
    const client = new QueryClient();
    let attempts = 0;
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceSessionListActive: async () => [] },
        bridge: {
          subscribeWorkspaceSessionUpdates: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("Subscription unavailable");
            return () => {};
          },
        },
      }),
    );
    const harness = createHookHarness<number, ReturnType<typeof useWorkspaceSessionRecords>>(
      (generation) => useWorkspaceSessionRecords("A", client, generation),
      0,
    );
    try {
      await harness.mount();
      expect(harness.getLatest().subscriptionError).toBe("Subscription unavailable");
      await harness.update(1);
      expect(attempts).toBe(2);
      expect(harness.getLatest().subscriptionError).toBeNull();
    } finally {
      await harness.unmount();
      client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("routes events to the owning cache and ignores a closed workspace subscription", async () => {
    const client = new QueryClient();
    const listeners: WorkspaceSessionUpdateListener[] = [];
    const stopped: number[] = [];
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceSessionListActive: async (id) => [record(id)] },
        bridge: {
          subscribeWorkspaceSessionUpdates: async (listener) => {
            const index = listeners.push(listener) - 1;
            return () => {
              stopped.push(index);
            };
          },
        },
      }),
    );
    const harness = createHookHarness<string, ReturnType<typeof useWorkspaceSessionRecords>>(
      (id: string) => useWorkspaceSessionRecords(id, client, 0),
      "A",
    );
    try {
      await harness.mount();
      await harness.waitFor((state) => state.records.isSuccess);
      await harness.update("B");
      await harness.waitFor((state) => state.records.data?.[0]?.manualTitle === "B");
      expect(stopped).toEqual([0]);
      await harness.run(() => {
        listeners[0]!({ workspaceId: "B", session: record("stale") });
        listeners[1]!({ workspaceId: "A", session: record("A updated") });
      });
      expect(harness.getLatest().records.data?.[0]?.manualTitle).toBe("B");
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", false))?.[0]
          ?.manualTitle,
      ).toBe("A updated");
    } finally {
      await harness.unmount();
      client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
    expect(stopped).toEqual([0, 1]);
  });

  test("keeps durable records after a stream warning and refetches on reconnect", async () => {
    const client = new QueryClient();
    let emit!: WorkspaceSessionUpdateListener;
    let reads = 0;
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceSessionListActive: async () => [record(`read-${++reads}`)] },
        bridge: {
          subscribeWorkspaceSessionUpdates: async (listener) => {
            emit = listener;
            return () => {};
          },
        },
      }),
    );
    const harness = createHookHarness(() => useWorkspaceSessionRecords("A", client, 0), undefined);
    try {
      await harness.mount();
      await harness.waitFor((state) => state.records.isSuccess);
      await harness.run(() =>
        emit({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Connection lost",
        }),
      );
      expect(harness.getLatest().subscriptionError).toBe("Connection lost");
      expect(harness.getLatest().records.data?.[0]?.manualTitle).toBe("read-1");
      await harness.run(() =>
        emit({ __openducktorBrowserLive: true, kind: "reconnected", transportEpoch: "next" }),
      );
      await harness.waitFor((state) => state.records.data?.[0]?.manualTitle === "read-2");
      expect(harness.getLatest().subscriptionError).toBeNull();
    } finally {
      await harness.unmount();
      client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("releases a subscription that finishes opening after unmount", async () => {
    const client = new QueryClient();
    let finish!: (stop: () => void) => void;
    let stops = 0;
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceSessionListActive: async () => [] },
        bridge: {
          subscribeWorkspaceSessionUpdates: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        },
      }),
    );
    const harness = createHookHarness(() => useWorkspaceSessionRecords("A", client, 0), undefined);
    try {
      await harness.mount();
      await harness.unmount();
      finish(() => {
        stops += 1;
      });
      await Promise.resolve();
      expect(stops).toBe(1);
    } finally {
      client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { HostRuntimeSnapshot } from "@openducktor/contracts";
import { createHostClientFixture } from "@/test-utils/focused-fixture";
import {
  configureShellBridge,
  createDisabledAppUpdateBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "./shell-bridge";

const createRuntimeSnapshot = (hostInstanceId: string): HostRuntimeSnapshot => ({
  hostInstanceId,
  runtimes: [],
  mcpBridge: {
    state: "ready",
    hostUrl: "http://127.0.0.1:4000",
    failure: null,
    updatedAt: "2026-10-03T10:00:00.000Z",
    revision: 1,
  },
});

const createTestShellBridge = (overrides: Partial<ShellBridge> = {}): ShellBridge => ({
  client: createHostClientFixture({}),
  subscribeWorkspaceSessionUpdates: async () => () => {},
  subscribeRuntimeChanges: async () => () => {},
  subscribeRunEvents: async () => () => {},
  subscribeWorkspaceProviderSetupUpdates: async () => () => {},
  subscribeAzureDevOpsConnectionUpdates: async () => () => {},
  subscribeDevServerEvents: async () => ({
    transportEpoch: "test:0",
    unsubscribe: () => {},
  }),
  observeAgentSessionLive: async () => () => {},
  subscribeNotificationStream: async () => () => {},
  subscribeTaskStream: async () => ({
    subscriptionId: "test-subscription",
    acknowledge: async () => {},
    unsubscribe: () => {},
  }),
  appUpdates: createDisabledAppUpdateBridge({
    status: "disabled",
    currentVersion: "unknown",
    disabledCode: "updater_unavailable",
    disabledReason: "Updates are unavailable in this test shell.",
  }),
  capabilities: {
    canOpenExternalUrls: true,
    canPreviewLocalAttachments: true,
  },
  notifications: createUnavailableShellBridge().notifications,
  openExternalUrl: async () => {},
  resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
  resolveTaskAssetSrc: async () => "asset://task-preview",
  terminals: createUnavailableShellBridge().terminals,
  ...overrides,
});

describe("host-client", () => {
  afterEach(() => {
    configureShellBridge(createUnavailableShellBridge());
  });

  test("fails fast when no shell bridge has been configured", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeRunEvents(() => {})).rejects.toThrow(
      "OpenDucktor shell bridge is not configured. Start through the desktop shell or @openducktor/web.",
    );
  });

  test("forwards task stream subscriptions and terminal failures to the active shell bridge", async () => {
    const listener = mock(() => {});
    const terminalFailure = new Error("stream terminated");
    const onTerminalFailure = mock((cause: unknown) => {
      void cause;
    });
    const unsubscribe = mock(() => {});
    const acknowledge = mock(async () => {});
    const subscribeTaskStream = mock(async (_input, receivedFrame, receivedTerminalFailure) => {
      receivedFrame({
        type: "snapshot_required",
        cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 },
        reason: "buffer_gap",
      });
      receivedTerminalFailure?.(terminalFailure);
      return { subscriptionId: "test-subscription", acknowledge, unsubscribe };
    });
    configureShellBridge(createTestShellBridge({ subscribeTaskStream }));

    const { hostBridge } = await import("./host-client");
    const result = await hostBridge.subscribeTaskStream(
      { cursor: null },
      listener,
      onTerminalFailure,
    );

    expect(listener).toHaveBeenCalledWith({
      type: "snapshot_required",
      cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 },
      reason: "buffer_gap",
    });
    expect(onTerminalFailure).toHaveBeenCalledWith(terminalFailure);
    expect(result.unsubscribe).toBe(unsubscribe);
  });

  test("hostClient proxies calls to the currently configured shell client", async () => {
    const firstRuntimeStatus = mock(async () => createRuntimeSnapshot("runtime-1"));
    const secondRuntimeStatus = mock(async () => createRuntimeSnapshot("runtime-2"));

    configureShellBridge(
      createTestShellBridge({
        client: createHostClientFixture({ runtimeStatus: firstRuntimeStatus }),
      }),
    );

    const { hostClient } = await import("./host-client");

    await expect(hostClient.runtimeStatus()).resolves.toMatchObject({
      hostInstanceId: "runtime-1",
    });

    configureShellBridge(
      createTestShellBridge({
        client: createHostClientFixture({ runtimeStatus: secondRuntimeStatus }),
      }),
    );

    await expect(hostClient.runtimeStatus()).resolves.toMatchObject({
      hostInstanceId: "runtime-2",
    });
    expect(firstRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(secondRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  test("hostClient allows scoped method overrides for tests", async () => {
    const shellRuntimeStatus = mock(async () => createRuntimeSnapshot("runtime-shell"));
    const overrideRuntimeStatus = mock(async () => createRuntimeSnapshot("runtime-override"));
    configureShellBridge(
      createTestShellBridge({
        client: createHostClientFixture({ runtimeStatus: shellRuntimeStatus }),
      }),
    );

    const { hostClient } = await import("./host-client");
    const originalRuntimeStatus = hostClient.runtimeStatus;

    hostClient.runtimeStatus = overrideRuntimeStatus;
    try {
      await expect(hostClient.runtimeStatus()).resolves.toMatchObject({
        hostInstanceId: "runtime-override",
      });
    } finally {
      hostClient.runtimeStatus = originalRuntimeStatus;
    }

    await expect(hostClient.runtimeStatus()).resolves.toMatchObject({
      hostInstanceId: "runtime-shell",
    });
    expect(overrideRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(shellRuntimeStatus).toHaveBeenCalledTimes(1);
  });
});

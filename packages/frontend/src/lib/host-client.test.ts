import { afterEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import {
  configureShellBridge,
  createDisabledAppUpdateBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "./shell-bridge";

const createRuntimeInstanceSummary = (runtimeId: string): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId,
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4555",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const createTestShellBridge = (overrides: Partial<ShellBridge> = {}): ShellBridge => ({
  client: {} as HostClient,
  subscribeRunEvents: async () => () => {},
  subscribeDevServerEvents: async () => ({
    transportEpoch: "test:0",
    unsubscribe: () => {},
  }),
  observeAgentSessionLive: async () => () => {},
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
  openExternalUrl: async () => {},
  resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
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
    const onTerminalFailure = mock((_error: unknown) => {});
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
    const firstRuntimeEnsure = mock(async () => createRuntimeInstanceSummary("runtime-1"));
    const secondRuntimeEnsure = mock(async () => createRuntimeInstanceSummary("runtime-2"));

    configureShellBridge(
      createTestShellBridge({
        client: { runtimeEnsure: firstRuntimeEnsure } as unknown as HostClient,
      }),
    );

    const { hostClient } = await import("./host-client");

    await expect(hostClient.runtimeEnsure("/repo", "opencode")).resolves.toMatchObject({
      runtimeId: "runtime-1",
    });

    configureShellBridge(
      createTestShellBridge({
        client: { runtimeEnsure: secondRuntimeEnsure } as unknown as HostClient,
      }),
    );

    await expect(hostClient.runtimeEnsure("/repo", "opencode")).resolves.toMatchObject({
      runtimeId: "runtime-2",
    });
    expect(firstRuntimeEnsure).toHaveBeenCalledTimes(1);
    expect(secondRuntimeEnsure).toHaveBeenCalledTimes(1);
  });

  test("hostClient allows scoped method overrides for tests", async () => {
    const shellRuntimeEnsure = mock(async () => createRuntimeInstanceSummary("runtime-shell"));
    const overrideRuntimeEnsure = mock(async () =>
      createRuntimeInstanceSummary("runtime-override"),
    );
    configureShellBridge(
      createTestShellBridge({
        client: { runtimeEnsure: shellRuntimeEnsure } as unknown as HostClient,
      }),
    );

    const { hostClient } = await import("./host-client");
    const originalRuntimeEnsure = hostClient.runtimeEnsure;

    hostClient.runtimeEnsure = overrideRuntimeEnsure as HostClient["runtimeEnsure"];
    try {
      await expect(hostClient.runtimeEnsure("/repo", "opencode")).resolves.toMatchObject({
        runtimeId: "runtime-override",
      });
    } finally {
      hostClient.runtimeEnsure = originalRuntimeEnsure;
    }

    await expect(hostClient.runtimeEnsure("/repo", "opencode")).resolves.toMatchObject({
      runtimeId: "runtime-shell",
    });
    expect(overrideRuntimeEnsure).toHaveBeenCalledTimes(1);
    expect(shellRuntimeEnsure).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { TauriHostClient } from "@openducktor/adapters-tauri-host";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import {
  configureShellBridge,
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
  client: {} as TauriHostClient,
  subscribeRunEvents: async () => () => {},
  subscribeDevServerEvents: async () => () => {},
  subscribeTaskEvents: async () => () => {},
  capabilities: {
    canOpenExternalUrls: true,
    canPreviewLocalAttachments: true,
  },
  openExternalUrl: async () => {},
  resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
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

  test("returns the active shell bridge for event subscriptions", async () => {
    const listener = mock(() => {});
    const unsubscribe = mock(() => {});
    const subscribeTaskEvents = mock(async (receivedListener: (payload: unknown) => void) => {
      receivedListener({ kind: "tasks_updated", repoPath: "/repo", taskIds: ["task-1"] });
      return unsubscribe;
    });
    configureShellBridge(createTestShellBridge({ subscribeTaskEvents }));

    const { createHostBridge } = await import("./host-client");
    const result = await createHostBridge().subscribeTaskEvents(listener);

    expect(listener).toHaveBeenCalledWith({
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-1"],
    });
    expect(result).toBe(unsubscribe);
  });

  test("hostClient proxies calls to the currently configured shell client", async () => {
    const firstRuntimeEnsure = mock(async () => createRuntimeInstanceSummary("runtime-1"));
    const secondRuntimeEnsure = mock(async () => createRuntimeInstanceSummary("runtime-2"));

    configureShellBridge(
      createTestShellBridge({
        client: { runtimeEnsure: firstRuntimeEnsure } as unknown as TauriHostClient,
      }),
    );

    const { hostClient } = await import("./host-client");

    await expect(hostClient.runtimeEnsure("/repo", "opencode")).resolves.toMatchObject({
      runtimeId: "runtime-1",
    });

    configureShellBridge(
      createTestShellBridge({
        client: { runtimeEnsure: secondRuntimeEnsure } as unknown as TauriHostClient,
      }),
    );

    await expect(hostClient.runtimeEnsure("/repo", "opencode")).resolves.toMatchObject({
      runtimeId: "runtime-2",
    });
    expect(firstRuntimeEnsure).toHaveBeenCalledTimes(1);
    expect(secondRuntimeEnsure).toHaveBeenCalledTimes(1);
  });
});

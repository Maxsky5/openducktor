import { devServerGroupStateSchema } from "@openducktor/contracts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { act, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import type { DevServerEventListener } from "@/lib/shell-bridge";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  buildScript,
  buildState,
  createDeferred,
} from "./use-agent-studio-dev-server-panel-test-fixtures";
import { renderDevServerPanelHook } from "./use-agent-studio-dev-server-panel-test-harness";

type TestDevServerEventSubscription = {
  transportEpoch: string;
  unsubscribe: () => void;
};

if (globalThis.document === undefined) {
  GlobalRegistrator.register();
}

let devServerGetState = async (
  _repoPath: string,
  _owner: DevServerOwner,
): Promise<DevServerGroupState> => buildState();
let devServerStart = async (
  _repoPath: string,
  _owner: DevServerOwner,
): Promise<DevServerGroupState> => buildState();
let devServerStop = async (
  _repoPath: string,
  _owner: DevServerOwner,
): Promise<DevServerGroupState> => buildState();
let devServerRestart = async (
  _repoPath: string,
  _owner: DevServerOwner,
): Promise<DevServerGroupState> => buildState();
let devServerEventListener: DevServerEventListener | null = null;
let subscriptionTransportEpoch = "test:0";
let subscribeDevServerEventsMock = async (
  listener: DevServerEventListener,
): Promise<TestDevServerEventSubscription> => {
  devServerEventListener = listener;
  return {
    transportEpoch: subscriptionTransportEpoch,
    unsubscribe: () => {
      devServerEventListener = null;
    },
  };
};

beforeEach(() => {
  devServerGetState = async (
    _repoPath: string,
    _owner: DevServerOwner,
  ): Promise<DevServerGroupState> => buildState();
  devServerStart = async (
    _repoPath: string,
    _owner: DevServerOwner,
  ): Promise<DevServerGroupState> => buildState();
  devServerStop = async (_repoPath: string, _owner: DevServerOwner): Promise<DevServerGroupState> =>
    buildState();
  devServerRestart = async (
    _repoPath: string,
    _owner: DevServerOwner,
  ): Promise<DevServerGroupState> => buildState();
  devServerEventListener = null;
  subscriptionTransportEpoch = "test:0";
  subscribeDevServerEventsMock = async (listener: DevServerEventListener) => {
    devServerEventListener = listener;
    return {
      transportEpoch: subscriptionTransportEpoch,
      unsubscribe: () => {
        devServerEventListener = null;
      },
    };
  };
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        devServerGetState: (...args) => devServerGetState(...args),
        devServerStart: (...args) => devServerStart(...args),
        devServerStop: (...args) => devServerStop(...args),
        devServerRestart: (...args) => devServerRestart(...args),
      },
      bridge: {
        subscribeDevServerEvents: (listener) => subscribeDevServerEventsMock(listener),
      },
    }),
  );
});

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("useAgentStudioDevServerPanel subscriptions", () => {
  test("retries a failed state read for the selected Workspace Session", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    const owner: DevServerOwner = {
      kind: "workspace_session",
      workspaceId: "workspace-1",
      sessionId: "session-1",
    };
    const readOwners: DevServerOwner[] = [];
    devServerGetState = async (_repoPath, requestedOwner) => {
      readOwners.push(requestedOwner);
      if (readOwners.length === 1) throw new Error("State read failed.");
      return buildState({ owner });
    };

    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      owner,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("error");
      });
      expect(harness.getLatest().error).toBe("State read failed.");
      expect(readOwners).toEqual([owner]);

      act(() => harness.getLatest().onRetry());

      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("stopped");
      });
      expect(harness.getLatest().error).toBeNull();
      expect(readOwners).toEqual([owner, owner]);
    } finally {
      harness.unmount();
    }
  });

  test("retries a failed event subscription before reading state", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    let subscribeCount = 0;
    let readCount = 0;
    devServerGetState = async () => {
      readCount += 1;
      return buildState();
    };
    subscribeDevServerEventsMock = async (listener) => {
      subscribeCount += 1;
      if (subscribeCount === 1) throw new Error("Event subscription failed.");
      devServerEventListener = listener;
      return {
        transportEpoch: "test:1",
        unsubscribe: () => {
          devServerEventListener = null;
        },
      };
    };

    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-7" },
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("error");
      });
      expect(harness.getLatest().error).toBe("Event subscription failed.");
      expect(readCount).toBe(0);

      act(() => harness.getLatest().onRetry());

      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("stopped");
      });
      expect(harness.getLatest().error).toBeNull();
      expect(subscribeCount).toBe(2);
      expect(readCount).toBe(1);
      expect(devServerEventListener).not.toBeNull();
    } finally {
      harness.unmount();
    }
  });

  test("subscribes to dev-server events while enabled so startup events are not missed", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-7" },
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("stopped");
      });
      expect(devServerEventListener).not.toBeNull();
    } finally {
      harness.unmount();
    }
  });

  test("ignores a mutation result that resolves after the active task changes", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async (_repoPath, taskId) =>
      buildState({
        owner: taskId,
        workingDirectory: `/tmp/worktree/${taskId.kind === "task" ? taskId.taskId : taskId.sessionId}`,
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
            terminalId: `terminal-${taskId.kind === "task" ? taskId.taskId : taskId.sessionId}`,
          }),
        ],
      });
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-7" },
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().workingDirectory).toBe("/tmp/worktree/task-7");
      });

      await act(async () => {
        harness.getLatest().onRestart();
      });

      act(() => {
        harness.update({
          repoPath: "/repo",
          owner: { kind: "task", taskId: "task-8" },
          enabled: true,
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().workingDirectory).toBe("/tmp/worktree/task-8");
      });

      await act(async () => {
        restartDeferred.resolve(
          buildState({
            owner: { kind: "task", taskId: "task-7" },
            workingDirectory: "/tmp/worktree/task-7",
            updatedAt: "2026-03-19T15:31:00.000Z",
            scripts: [
              buildScript({
                status: "running",
                pid: 5252,
                startedAt: "2026-03-19T15:31:00.000Z",
                terminalId: "terminal-output",
              }),
            ],
          }),
        );
      });

      await waitFor(() => {
        expect(harness.getLatest().workingDirectory).toBe("/tmp/worktree/task-8");
      });
      expect(harness.getLatest().selectedScript?.terminalId).toBe("terminal-task-8");
    } finally {
      harness.unmount();
    }
  });

  test("does not expose a pending dev-server mutation after the active task changes", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async (_repoPath, taskId) =>
      buildState({
        owner: taskId,
        workingDirectory: `/tmp/worktree/${taskId.kind === "task" ? taskId.taskId : taskId.sessionId}`,
        scripts: [
          buildScript({
            status: "running",
            pid: taskId.kind === "task" && taskId.taskId === "task-7" ? 4242 : 5252,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
        ],
      });
    const stopDeferred = createDeferred<DevServerGroupState>();
    devServerStop = async () => stopDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-7" },
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().workingDirectory).toBe("/tmp/worktree/task-7");
      });

      act(() => {
        harness.getLatest().onStop();
      });

      await waitFor(() => {
        expect(harness.getLatest().isStopPending).toBe(true);
      });

      act(() => {
        harness.update({
          repoPath: "/repo",
          owner: { kind: "task", taskId: "task-8" },
          enabled: true,
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().workingDirectory).toBe("/tmp/worktree/task-8");
      });
      expect(harness.getLatest().isStopPending).toBe(false);
      expect(harness.getLatest().isStartPending).toBe(false);
      expect(harness.getLatest().isRestartPending).toBe(false);

      stopDeferred.resolve(
        buildState({
          owner: { kind: "task", taskId: "task-7" },
          workingDirectory: "/tmp/worktree/task-7",
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  test("surfaces dev-server actions without an active task as actionable errors", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: null,
      owner: { kind: "task", taskId: "task-7" },
      enabled: true,
    });

    try {
      act(() => {
        harness.getLatest().onStart();
      });

      expect(harness.getLatest().error).toBe("Dev servers require an active repository and owner.");
    } finally {
      harness.unmount();
    }
  });

  test("rejects retired cache and callbacks when a fresh subscription opens on a new host", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");

    const retiredHostState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4141,
          startedAt: "2026-03-19T15:30:00.000Z",
          terminalId: "terminal-retired",
        }),
      ],
    });
    const currentHostState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          pid: 5151,
          startedAt: "2026-03-19T15:31:00.000Z",
          terminalId: "terminal-current",
        }),
      ],
    });
    const retiredRestart = createDeferred<DevServerGroupState>();
    const queryClient = createQueryClient();
    let activeHostState = retiredHostState;
    devServerGetState = async () => activeHostState;
    devServerRestart = async () => retiredRestart.promise;

    const retiredHarness = renderDevServerPanelHook(
      useAgentStudioDevServerPanel,
      {
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-7" },
        enabled: true,
      },
      { queryClient },
    );

    await waitFor(() => {
      expect(retiredHarness.getLatest().selectedScript?.terminalId).toBe("terminal-retired");
    });
    act(() => {
      retiredHarness.getLatest().onRestart();
    });
    const retiredHostListener = devServerEventListener;
    retiredHarness.unmount();

    activeHostState = currentHostState;
    subscriptionTransportEpoch = "test:1";
    const currentHarness = renderDevServerPanelHook(
      useAgentStudioDevServerPanel,
      {
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-7" },
        enabled: true,
      },
      { queryClient },
    );

    try {
      await waitFor(() => {
        expect(currentHarness.getLatest().selectedScript?.terminalId).toBe("terminal-current");
      });

      await act(async () => {
        retiredRestart.resolve(retiredHostState);
        retiredHostListener?.({ type: "snapshot", state: retiredHostState });
        await retiredRestart.promise;
        await Promise.resolve();
      });

      expect(currentHarness.getLatest().selectedScript?.terminalId).toBe("terminal-current");
    } finally {
      currentHarness.unmount();
    }
  });

  // This hook test settles a query and mutation across two React transport updates.
  test("binds query and mutation results to the browser transport epoch", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");

    const staleInitialQuery = createDeferred<DevServerGroupState>();
    const staleRestart = createDeferred<DevServerGroupState>();
    const currentHostState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 5252,
          startedAt: "2026-03-19T15:31:00.000Z",
          terminalId: "terminal-current",
        }),
      ],
    });
    let getStateCalls = 0;
    let staleInitialQuerySettled = false;
    let staleRestartSettled = false;
    devServerGetState = async () => {
      getStateCalls += 1;
      if (getStateCalls !== 1) {
        return currentHostState;
      }
      const result = await staleInitialQuery.promise;
      staleInitialQuerySettled = true;
      return result;
    };
    devServerRestart = async () => {
      const result = await staleRestart.promise;
      staleRestartSettled = true;
      return result;
    };

    const queryClient = createQueryClient();
    const harness = renderDevServerPanelHook(
      useAgentStudioDevServerPanel,
      {
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-7" },
        enabled: true,
      },
      { queryClient },
    );

    try {
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      act(() => {
        devServerEventListener?.({
          __openducktorBrowserLive: true,
          kind: "reconnected",
          transportEpoch: "test:1",
        });
      });

      await waitFor(() => {
        expect(getStateCalls).toBe(2);
        expect(harness.getLatest().selectedScript?.terminalId).toBe("terminal-current");
      });

      act(() => {
        harness.getLatest().onRestart();
      });

      await act(async () => {
        devServerEventListener?.({
          __openducktorBrowserLive: true,
          kind: "reconnected",
          transportEpoch: "test:2",
        });
        staleRestart.resolve(
          buildState({
            scripts: [
              buildScript({
                status: "running",
                terminalId: "terminal-stale",
                pid: 4242,
                startedAt: "2026-03-19T15:29:00.000Z",
              }),
            ],
          }),
        );
        staleInitialQuery.resolve(
          buildState({
            scripts: [
              buildScript({
                status: "running",
                terminalId: "terminal-initial-stale",
                pid: 3131,
                startedAt: "2026-03-19T15:28:00.000Z",
              }),
            ],
          }),
        );
        await Promise.all([staleRestart.promise, staleInitialQuery.promise]);
        await Promise.resolve();
      });

      await waitFor(() => {
        const staleQuery = queryClient.getQueryCache().find({
          queryKey: devServerQueryKeys.state("/repo", { kind: "task", taskId: "task-7" }, "test:0"),
          exact: true,
        });
        const hasSettledStaleMutation = queryClient
          .getMutationCache()
          .getAll()
          .some((mutation) => {
            const data = devServerGroupStateSchema.safeParse(mutation.state.data);
            return (
              mutation.state.status === "success" &&
              data.success &&
              data.data.scripts[0]?.terminalId === "terminal-stale"
            );
          });
        expect(staleQuery?.state.status).toBe("success");
        expect(staleQuery?.state.fetchStatus).toBe("idle");
        expect(hasSettledStaleMutation).toBe(true);
        expect(staleRestartSettled).toBe(true);
        expect(staleInitialQuerySettled).toBe(true);
        expect(harness.getLatest().selectedScript?.terminalId).toBe("terminal-current");
      });
    } finally {
      harness.unmount();
    }
  }, 2_500);
});

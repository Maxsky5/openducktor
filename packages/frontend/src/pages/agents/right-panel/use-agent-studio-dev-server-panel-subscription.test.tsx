import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState } from "@openducktor/contracts";
import { act, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  buildScript,
  buildState,
  createDeferred,
  repoSettings,
} from "./use-agent-studio-dev-server-panel-test-fixtures";
import { renderDevServerPanelHook } from "./use-agent-studio-dev-server-panel-test-harness";

const actualHostClientModule = await import("@/lib/host-client");

type TestDevServerEventSubscription = {
  transportEpoch: string;
  unsubscribe: () => void;
};

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

let devServerGetState = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerStart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerStop = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerRestart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerEventListener: ((payload: unknown) => void) | null = null;
let subscriptionTransportEpoch = "test:0";
let subscribeDevServerEventsMock = async (
  listener: (payload: unknown) => void,
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
  mock.module("@/lib/host-client", () => ({
    hostClient: {
      devServerGetState: (...args: [string, string]) => devServerGetState(...args),
      devServerStart: (...args: [string, string]) => devServerStart(...args),
      devServerStop: (...args: [string, string]) => devServerStop(...args),
      devServerRestart: (...args: [string, string]) => devServerRestart(...args),
    },
    subscribeDevServerEvents: (listener: (payload: unknown) => void) =>
      subscribeDevServerEventsMock(listener),
  }));
  devServerGetState = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerStart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerStop = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerRestart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerEventListener = null;
  subscriptionTransportEpoch = "test:0";
  subscribeDevServerEventsMock = async (listener: (payload: unknown) => void) => {
    devServerEventListener = listener;
    return {
      transportEpoch: subscriptionTransportEpoch,
      unsubscribe: () => {
        devServerEventListener = null;
      },
    };
  };
});

afterEach(async () => {
  await restoreMockedModules([["@/lib/host-client", async () => actualHostClientModule]]);
});

describe("useAgentStudioDevServerPanel subscriptions", () => {
  test("subscribes to dev-server events while enabled so startup events are not missed", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
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

  test("rehydrates buffered terminal replay after a browser-live stream warning", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const initialState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
        }),
      ],
    });
    const refreshedState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 4,
              data: "rehydrated output\r\n",
              timestamp: "2026-03-19T15:31:00.000Z",
            },
          ],
        }),
      ],
    });
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return getStateCalls === 1 ? initialState : refreshedState;
    };
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("active");
      });

      await act(async () => {
        harness.getLatest().onRestart();
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        devServerEventListener?.({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Dev server stream skipped 4 events; reconnect will replay buffered events.",
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "rehydrated output\r\n",
        );
      });
      expect(getStateCalls).toBe(2);
      restartDeferred.resolve(refreshedState);
    } finally {
      harness.unmount();
    }
  });

  test("hydrates full buffered terminal replay after the dev-server subscription becomes ready", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const bufferedTerminalChunks = Array.from({ length: 300 }, (_, sequence) => ({
      scriptId: "frontend",
      runIdentity: {
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
      },
      sequence,
      data: `subscription-gap output ${sequence}\r\n`,
      timestamp: "2026-03-19T15:31:00.000Z",
    }));
    const refreshedState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks,
        }),
      ],
    });
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return refreshedState;
    };
    const subscriptionReady = createDeferred<TestDevServerEventSubscription>();
    subscribeDevServerEventsMock = async (listener: (payload: unknown) => void) => {
      devServerEventListener = listener;
      return subscriptionReady.promise;
    };

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      expect(harness.getLatest().mode).toBe("loading");
      expect(getStateCalls).toBe(0);

      subscriptionReady.resolve({
        transportEpoch: "test:0",
        unsubscribe: () => {
          devServerEventListener = null;
        },
      });

      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(300);
      });
      expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
        "subscription-gap output 0\r\n",
      );
      expect(harness.getLatest().selectedScriptTerminalBuffer?.entries.at(-1)?.data).toBe(
        "subscription-gap output 299\r\n",
      );
      expect(getStateCalls).toBe(1);
    } finally {
      harness.unmount();
    }
  });

  test("does not replace newer live terminal output with a stale browser-live rehydrate replay", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const initialState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "Starting `cd apps/web && pnpm dev`\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const staleRehydrateState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "Starting `cd apps/web && pnpm dev`\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const staleRehydrate = createDeferred<DevServerGroupState>();
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return getStateCalls === 1 ? initialState : staleRehydrate.promise;
    };
    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "Starting `cd apps/web && pnpm dev`\r\n",
        );
      });
      const initialResetToken = harness.getLatest().selectedScriptTerminalBuffer?.resetToken;
      expect(getStateCalls).toBe(1);

      act(() => {
        devServerEventListener?.({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Dev server stream skipped events; reconnect will replay buffered events.",
        });
      });

      await waitFor(() => {
        expect(getStateCalls).toBe(2);
      });

      act(() => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runIdentity: {
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
            },
            sequence: 1,
            data: "$ cd apps/web && pnpm dev\r\n",
            timestamp: "2026-03-19T15:30:01.000Z",
          },
        });
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runIdentity: {
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
            },
            sequence: 2,
            data: "ELIFECYCLE Command failed.\r\n",
            timestamp: "2026-03-19T15:30:02.000Z",
          },
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(3);
      });

      await act(async () => {
        staleRehydrate.resolve(staleRehydrateState);
      });

      await waitFor(() => {
        expect(
          harness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
        ).toEqual([
          "Starting `cd apps/web && pnpm dev`\r\n",
          "$ cd apps/web && pnpm dev\r\n",
          "ELIFECYCLE Command failed.\r\n",
        ]);
      });
      expect(harness.getLatest().selectedScriptTerminalBuffer?.resetToken).toBe(initialResetToken);
    } finally {
      harness.unmount();
    }
  });

  test("does not replace newer live terminal output with stale snapshot or status replay", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () =>
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runIdentity: {
              runId: "frontend:2",
              runOrder: { hostInstanceId: "host-1", generation: 2 },
            },
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
        ],
      });

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    const emitLiveFailureOutput = (): void => {
      devServerEventListener?.({
        type: "terminal_chunk",
        repoPath: "/repo",
        taskId: "task-7",
        terminalChunk: {
          scriptId: "frontend",
          runIdentity: {
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
          },
          sequence: 1,
          data: "$ cd apps/web && pnpm dev\r\n",
          timestamp: "2026-03-19T15:30:01.000Z",
        },
      });
      devServerEventListener?.({
        type: "terminal_chunk",
        repoPath: "/repo",
        taskId: "task-7",
        terminalChunk: {
          scriptId: "frontend",
          runIdentity: {
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
          },
          sequence: 2,
          data: "ELIFECYCLE Command failed.\r\n",
          timestamp: "2026-03-19T15:30:02.000Z",
        },
      });
    };
    const expectLiveFailureOutput = async (): Promise<void> => {
      await waitFor(() => {
        expect(
          harness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
        ).toEqual(["$ cd apps/web && pnpm dev\r\n", "ELIFECYCLE Command failed.\r\n"]);
        expect(harness.getLatest().scripts[0]?.runIdentity?.runId).toBe("frontend:2");
      });
    };
    const staleStartingScript = buildScript({
      status: "starting",
      pid: null,
      startedAt: null,
      bufferedTerminalChunks: [
        {
          scriptId: "frontend",
          runIdentity: {
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
          },
          sequence: 0,
          data: "Starting `cd apps/web && pnpm dev`\r\n",
          timestamp: "2026-03-19T15:30:00.000Z",
        },
      ],
    });
    const staleForeignStartingScript = buildScript({
      status: "starting",
      runIdentity: {
        runId: "retired-host-run",
        runOrder: { hostInstanceId: "retired-host", generation: 99 },
      },
      bufferedTerminalChunks: [
        {
          scriptId: "frontend",
          runIdentity: {
            runId: "retired-host-run",
            runOrder: { hostInstanceId: "retired-host", generation: 99 },
          },
          sequence: 0,
          data: "Retired host starting\r\n",
          timestamp: "2026-03-19T15:29:00.000Z",
        },
      ],
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("active");
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      act(emitLiveFailureOutput);
      await expectLiveFailureOutput();

      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:30:03.000Z",
          script: staleStartingScript,
        });
      });
      await expectLiveFailureOutput();

      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:30:03.500Z",
          script: staleForeignStartingScript,
        });
      });
      await expectLiveFailureOutput();

      act(() => {
        devServerEventListener?.({
          type: "snapshot",
          state: buildState({
            updatedAt: "2026-03-19T15:30:04.000Z",
            scripts: [staleStartingScript],
          }),
        });
      });
      await expectLiveFailureOutput();
    } finally {
      harness.unmount();
    }
  });

  test("rejects foreign host events for an unowned script in an owned group", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () =>
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runIdentity: {
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-current", generation: 1 },
            },
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
          buildScript({
            scriptId: "backend",
            name: "Backend",
            command: "bun run api",
          }),
        ],
      });

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings: {
        ...repoSettings,
        devServers: [
          ...repoSettings.devServers,
          { id: "backend", name: "Backend", command: "bun run api" },
        ],
      },
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().scripts).toHaveLength(2);
        expect(devServerEventListener).not.toBeNull();
      });

      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:31:00.000Z",
          script: buildScript({
            scriptId: "backend",
            name: "Backend",
            command: "bun run api",
            status: "starting",
            runIdentity: {
              runId: "backend:foreign",
              runOrder: { hostInstanceId: "host-foreign", generation: 99 },
            },
          }),
        });
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "backend",
            runIdentity: {
              runId: "backend:foreign",
              runOrder: { hostInstanceId: "host-foreign", generation: 99 },
            },
            sequence: 0,
            data: "foreign backend output\r\n",
            timestamp: "2026-03-19T15:31:00.000Z",
          },
        });
      });

      const backend = harness.getLatest().scripts.find((script) => script.scriptId === "backend");
      expect(backend?.status).toBe("stopped");
      expect(backend?.runIdentity).toBeNull();

      act(() => {
        harness.getLatest().onSelectScript("backend");
      });
      expect(harness.getLatest().selectedScriptTerminalBuffer?.entries).toEqual([]);
    } finally {
      harness.unmount();
    }
  });

  test("does not expose the previous task terminal buffer after the task scope changes", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async (_repoPath, taskId) =>
      buildState({
        taskId,
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
            bufferedTerminalChunks:
              taskId === "task-7"
                ? [
                    {
                      scriptId: "frontend",
                      runIdentity: {
                        runId: "frontend:1",
                        runOrder: { hostInstanceId: "host-1", generation: 1 },
                      },
                      sequence: 7,
                      data: "previous task output\r\n",
                      timestamp: "2026-03-19T15:30:00.000Z",
                    },
                  ]
                : [],
          }),
        ],
      });

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "previous task output\r\n",
        );
      });

      act(() => {
        harness.update({
          repoPath: "/repo",
          taskId: "task-8",
          repoSettings,
          enabled: true,
        });
      });

      expect(harness.getLatest().selectedScriptTerminalBuffer).toBeNull();
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
        taskId,
        worktreePath: `/tmp/worktree/${taskId}`,
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
        ],
      });
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-7");
      });

      await act(async () => {
        harness.getLatest().onRestart();
      });

      act(() => {
        harness.update({
          repoPath: "/repo",
          taskId: "task-8",
          repoSettings,
          enabled: true,
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-8");
      });

      await act(async () => {
        restartDeferred.resolve(
          buildState({
            taskId: "task-7",
            worktreePath: "/tmp/worktree/task-7",
            updatedAt: "2026-03-19T15:31:00.000Z",
            scripts: [
              buildScript({
                status: "running",
                pid: 5252,
                startedAt: "2026-03-19T15:31:00.000Z",
                bufferedTerminalChunks: [
                  {
                    scriptId: "frontend",
                    runIdentity: {
                      runId: "frontend:1",
                      runOrder: { hostInstanceId: "host-1", generation: 1 },
                    },
                    sequence: 0,
                    data: "task seven restarted output\r\n",
                    timestamp: "2026-03-19T15:31:00.000Z",
                  },
                ],
              }),
            ],
          }),
        );
      });

      await waitFor(() => {
        expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-8");
      });
      expect(harness.getLatest().selectedScriptTerminalBuffer?.entries).toEqual([]);
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
        taskId,
        worktreePath: `/tmp/worktree/${taskId}`,
        scripts: [
          buildScript({
            status: "running",
            pid: taskId === "task-7" ? 4242 : 5252,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
        ],
      });
    const stopDeferred = createDeferred<DevServerGroupState>();
    devServerStop = async () => stopDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-7");
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
          taskId: "task-8",
          repoSettings,
          enabled: true,
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-8");
      });
      expect(harness.getLatest().isStopPending).toBe(false);
      expect(harness.getLatest().isStartPending).toBe(false);
      expect(harness.getLatest().isRestartPending).toBe(false);

      stopDeferred.resolve(
        buildState({
          taskId: "task-7",
          worktreePath: "/tmp/worktree/task-7",
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
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      act(() => {
        harness.getLatest().onStart();
      });

      expect(harness.getLatest().error).toBe(
        "Builder dev servers require an active repository and task.",
      );
    } finally {
      harness.unmount();
    }
  });

  test("replaces a returned task terminal buffer after its sequence resets while inactive", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const taskStateByTaskId = new Map<string, DevServerGroupState>([
      [
        "task-7",
        buildState({
          taskId: "task-7",
          worktreePath: "/tmp/worktree/task-7",
          scripts: [
            buildScript({
              status: "running",
              pid: 4242,
              startedAt: "2026-03-19T15:30:00.000Z",
              bufferedTerminalChunks: [
                {
                  scriptId: "frontend",
                  runIdentity: {
                    runId: "frontend:1",
                    runOrder: { hostInstanceId: "host-1", generation: 1 },
                  },
                  sequence: 7,
                  data: "old task seven output\r\n",
                  timestamp: "2026-03-19T15:30:00.000Z",
                },
              ],
            }),
          ],
        }),
      ],
      [
        "task-8",
        buildState({
          taskId: "task-8",
          worktreePath: "/tmp/worktree/task-8",
          scripts: [
            buildScript({
              status: "running",
              pid: 5252,
              startedAt: "2026-03-19T15:30:30.000Z",
            }),
          ],
        }),
      ],
    ]);
    devServerGetState = async (_repoPath, taskId) => {
      const state = taskStateByTaskId.get(taskId);
      if (!state) {
        throw new Error(`Missing test state for ${taskId}.`);
      }

      return state;
    };

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "old task seven output\r\n",
        );
      });

      act(() => {
        harness.update({
          repoPath: "/repo",
          taskId: "task-8",
          repoSettings,
          enabled: true,
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-8");
      });

      taskStateByTaskId.set(
        "task-7",
        buildState({
          taskId: "task-7",
          worktreePath: "/tmp/worktree/task-7",
          updatedAt: "2026-03-19T15:31:00.000Z",
          scripts: [
            buildScript({
              status: "running",
              pid: 6262,
              startedAt: "2026-03-19T15:31:00.000Z",
              bufferedTerminalChunks: [
                {
                  scriptId: "frontend",
                  runIdentity: {
                    runId: "frontend:2",
                    runOrder: { hostInstanceId: "host-1", generation: 2 },
                  },
                  sequence: 0,
                  data: "new task seven output\r\n",
                  timestamp: "2026-03-19T15:31:00.000Z",
                },
              ],
            }),
          ],
        }),
      );

      act(() => {
        harness.update({
          repoPath: "/repo",
          taskId: "task-7",
          repoSettings,
          enabled: true,
        });
      });

      await waitFor(() => {
        expect(
          harness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
        ).toEqual(["new task seven output\r\n"]);
      });
    } finally {
      harness.unmount();
    }
  });

  test("rehydrates buffered terminal replay after a browser-live reconnect", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const initialState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
              },
              sequence: 0,
              data: "stale output\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const refreshedState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          runIdentity: {
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-2", generation: 1 },
          },
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "frontend:2",
                runOrder: { hostInstanceId: "host-2", generation: 1 },
              },
              sequence: 2,
              data: "reconnected output\r\n",
              timestamp: "2026-03-19T15:31:00.000Z",
            },
          ],
        }),
      ],
    });
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return getStateCalls === 1 ? initialState : refreshedState;
    };

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "stale output\r\n",
        );
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        devServerEventListener?.({
          __openducktorBrowserLive: true,
          kind: "reconnected",
          transportEpoch: "test:1",
        });
      });

      await waitFor(() => {
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "reconnected output\r\n",
        );
      });
      expect(getStateCalls).toBe(2);
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
          runIdentity: {
            runId: "retired-run",
            runOrder: { hostInstanceId: "host-retired", generation: 1 },
          },
          pid: 4141,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "retired-run",
                runOrder: { hostInstanceId: "host-retired", generation: 1 },
              },
              sequence: 0,
              data: "retired host\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const currentHostState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          runIdentity: {
            runId: "current-run",
            runOrder: { hostInstanceId: "host-current", generation: 1 },
          },
          pid: 5151,
          startedAt: "2026-03-19T15:31:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "current-run",
                runOrder: { hostInstanceId: "host-current", generation: 1 },
              },
              sequence: 0,
              data: "current host\r\n",
              timestamp: "2026-03-19T15:31:00.000Z",
            },
          ],
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
        taskId: "task-7",
        repoSettings,
        enabled: true,
      },
      { queryClient },
    );

    await waitFor(() => {
      expect(retiredHarness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
        "retired host\r\n",
      );
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
        taskId: "task-7",
        repoSettings,
        enabled: true,
      },
      { queryClient },
    );

    try {
      expect(currentHarness.getLatest().selectedScriptTerminalBuffer).toBeNull();
      await waitFor(() => {
        expect(currentHarness.getLatest().scripts[0]?.runIdentity?.runOrder.hostInstanceId).toBe(
          "host-current",
        );
        expect(currentHarness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "current host\r\n",
        );
      });

      await act(async () => {
        retiredRestart.resolve(retiredHostState);
        retiredHostListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runIdentity: {
              runId: "retired-run",
              runOrder: { hostInstanceId: "host-retired", generation: 1 },
            },
            sequence: 1,
            data: "late retired output\r\n",
            timestamp: "2026-03-19T15:32:00.000Z",
          },
        });
        await retiredRestart.promise;
        await Promise.resolve();
      });

      expect(currentHarness.getLatest().scripts[0]?.runIdentity?.runOrder.hostInstanceId).toBe(
        "host-current",
      );
      expect(
        currentHarness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
      ).toEqual(["current host\r\n"]);
    } finally {
      currentHarness.unmount();
    }
  });

  test("binds query and mutation results to the browser transport epoch", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");

    const staleInitialQuery = createDeferred<DevServerGroupState>();
    const staleRestart = createDeferred<DevServerGroupState>();
    const currentHostState = buildState({
      scripts: [
        buildScript({
          status: "running",
          runIdentity: {
            runId: "host-current-run",
            runOrder: { hostInstanceId: "host-current", generation: 1 },
          },
          pid: 5252,
          startedAt: "2026-03-19T15:31:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runIdentity: {
                runId: "host-current-run",
                runOrder: { hostInstanceId: "host-current", generation: 1 },
              },
              sequence: 0,
              data: "current host\r\n",
              timestamp: "2026-03-19T15:31:00.000Z",
            },
          ],
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
        taskId: "task-7",
        repoSettings,
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
        expect(harness.getLatest().scripts[0]?.runIdentity?.runOrder.hostInstanceId).toBe(
          "host-current",
        );
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
                runIdentity: {
                  runId: "host-stale-run",
                  runOrder: { hostInstanceId: "host-stale", generation: 99 },
                },
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
                runIdentity: {
                  runId: "host-initial-stale-run",
                  runOrder: { hostInstanceId: "host-initial-stale", generation: 50 },
                },
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
          queryKey: devServerQueryKeys.state("/repo", "task-7", "test:0"),
          exact: true,
        });
        const hasSettledStaleMutation = queryClient
          .getMutationCache()
          .getAll()
          .some((mutation) => {
            const data = mutation.state.data as DevServerGroupState | undefined;
            return (
              mutation.state.status === "success" &&
              data?.scripts[0]?.runIdentity?.runId === "host-stale-run"
            );
          });
        expect(staleQuery?.state.status).toBe("success");
        expect(staleQuery?.state.fetchStatus).toBe("idle");
        expect(hasSettledStaleMutation).toBe(true);
        expect(staleRestartSettled).toBe(true);
        expect(staleInitialQuerySettled).toBe(true);
        expect(harness.getLatest().scripts[0]?.runIdentity?.runOrder.hostInstanceId).toBe(
          "host-current",
        );
        expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "current host\r\n",
        );
      });
    } finally {
      harness.unmount();
    }
  });

  test("surfaces invalid dev server event payloads as actionable errors", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () =>
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
        ],
      });
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("active");
      });

      await act(async () => {
        harness.getLatest().onRestart();
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      act(() => {
        devServerEventListener?.({ type: "terminal_chunk", repoPath: "/repo", taskId: "task-7" });
      });

      await waitFor(() => {
        expect(harness.getLatest().error).toContain("Received invalid dev server event payload");
      });
      restartDeferred.resolve(
        buildState({
          scripts: [
            buildScript({
              status: "running",
              pid: 4242,
              startedAt: "2026-03-19T15:30:00.000Z",
            }),
          ],
        }),
      );
    } finally {
      console.error = originalConsoleError;
      harness.unmount();
    }
  });
});

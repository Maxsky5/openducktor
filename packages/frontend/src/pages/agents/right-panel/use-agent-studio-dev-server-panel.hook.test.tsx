import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
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
let nextSubscriptionTransportEpoch = 0;
let subscribeDevServerEventsMock = async (
  listener: (payload: unknown) => void,
): Promise<{ transportEpoch: string; unsubscribe: () => void }> => {
  devServerEventListener = listener;
  const transportEpoch = `test:${nextSubscriptionTransportEpoch}`;
  nextSubscriptionTransportEpoch += 1;
  return {
    transportEpoch,
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
  nextSubscriptionTransportEpoch = 0;
  subscribeDevServerEventsMock = async (listener: (payload: unknown) => void) => {
    devServerEventListener = listener;
    const transportEpoch = `test:${nextSubscriptionTransportEpoch}`;
    nextSubscriptionTransportEpoch += 1;
    return {
      transportEpoch,
      unsubscribe: () => {
        devServerEventListener = null;
      },
    };
  };
});

afterEach(async () => {
  await restoreMockedModules([["@/lib/host-client", async () => actualHostClientModule]]);
});

describe("useAgentStudioDevServerPanel", () => {
  test("does not query dev-server state when the repository has no configured dev servers", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return buildState();
    };

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings: {
              ...repoSettings,
              devServers: [],
            },
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("empty");
      });
      expect(getLatest().disabledReason).toBe(
        "Configure one or more builder dev server commands in repository settings to stream them here.",
      );
      expect(getStateCalls).toBe(0);
      expect(devServerEventListener).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("returns a disabled reason when a builder worktree is unavailable", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () =>
      buildState({
        worktreePath: null,
      });

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("disabled");
      });
      expect(getLatest().disabledReason).toBe(
        "Create or resume a Builder worktree before starting repository dev servers.",
      );
    } finally {
      view.unmount();
    }
  });

  test("does not refetch dev-server state after a successful start mutation", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return buildState();
    };
    devServerStart = async () =>
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
          }),
        ],
      });

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("stopped");
      });
      expect(getStateCalls).toBe(1);

      await act(async () => {
        getLatest().onStart();
      });

      await waitFor(() => {
        expect(getLatest().scripts[0]?.status).toBe("running");
      });
      expect(getStateCalls).toBe(1);
    } finally {
      view.unmount();
    }
  });

  test("hydrates terminal replay from a successful start mutation before live events arrive", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () => buildState();
    devServerStart = async () =>
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
            bufferedTerminalChunks: [
              {
                scriptId: "frontend",
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
                sequence: 0,
                data: "Starting `bun run dev`\r\n",
                timestamp: "2026-03-19T15:30:00.000Z",
              },
            ],
          }),
        ],
      });

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("stopped");
      });

      await act(async () => {
        getLatest().onStart();
      });

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "Starting `bun run dev`\r\n",
        );
      });
      expect(getLatest().scripts[0]?.status).toBe("running");
    } finally {
      view.unmount();
    }
  });

  test("applies startup events before the start mutation resolves", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const startDeferred = createDeferred<DevServerGroupState>();
    devServerGetState = async () => buildState();
    devServerStart = async () => startDeferred.promise;

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("stopped");
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      act(() => {
        getLatest().onStart();
      });

      act(() => {
        devServerEventListener?.({
          type: "snapshot",
          state: buildState({
            scripts: [buildScript()],
          }),
        });
      });

      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:30:00.000Z",
          script: buildScript({
            status: "starting",
            bufferedTerminalChunks: [
              {
                scriptId: "frontend",
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
                sequence: 0,
                data: "Starting `bun run dev`\r\n",
                timestamp: "2026-03-19T15:30:00.000Z",
              },
            ],
          }),
        });
      });

      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });
      expect(getLatest().scripts[0]?.status).toBe("starting");
      expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
        "Starting `bun run dev`\r\n",
      );

      startDeferred.resolve(
        buildState({
          scripts: [
            buildScript({
              status: "running",
              pid: 4242,
              startedAt: "2026-03-19T15:30:00.000Z",
              bufferedTerminalChunks: [
                {
                  scriptId: "frontend",
                  runId: "frontend:1",
                  runOrder: { hostInstanceId: "host-1", generation: 1 },
                  sequence: 0,
                  data: "Starting `bun run dev`\r\n",
                  timestamp: "2026-03-19T15:30:00.000Z",
                },
              ],
            }),
          ],
        }),
      );
    } finally {
      view.unmount();
    }
  });

  test("starts from a stopped owned run without clearing replay before host ownership arrives", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const stoppedState = buildState({
      scripts: [
        buildScript({
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 3,
              data: "stopped replay\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const startDeferred = createDeferred<DevServerGroupState>();
    let startCalls = 0;
    devServerGetState = async () => stoppedState;
    devServerStart = async () => {
      startCalls += 1;
      return startDeferred.promise;
    };

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("stopped");
      });

      act(() => {
        getLatest().onStart();
      });

      expect(getLatest().scripts[0]?.status).toBe("stopped");
      expect(getLatest().selectedScript?.scriptId).toBe("frontend");
      expect(getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data)).toEqual([
        "stopped replay\r\n",
      ]);
      await waitFor(() => {
        expect(startCalls).toBe(1);
        expect(getLatest().mode).toBe("active");
        expect(getLatest().isExpanded).toBe(true);
      });

      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:31:00.000Z",
          script: buildScript({
            status: "starting",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
          }),
        });
      });

      expect(getLatest().scripts[0]?.status).toBe("starting");
      expect(getLatest().selectedScriptTerminalBuffer?.entries).toEqual([]);
    } finally {
      startDeferred.resolve(buildState());
      view.unmount();
    }
  });

  test("keeps successful scripts active when another dev server fails during start", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () => buildState();
    devServerStart = async () =>
      buildState({
        scripts: [
          buildScript({
            scriptId: "frontend",
            name: "Frontend",
            status: "running",
            pid: 4242,
            startedAt: "2026-03-19T15:30:00.000Z",
            bufferedTerminalChunks: [
              {
                scriptId: "frontend",
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
                sequence: 0,
                data: "ready\r\n",
                timestamp: "2026-03-19T15:30:00.000Z",
              },
            ],
          }),
          buildScript({
            scriptId: "backend",
            name: "Backend",
            command: "bun run api",
            status: "failed",
            lastError: "Dev server exited with code 1.",
            exitCode: 1,
            bufferedTerminalChunks: [
              {
                scriptId: "backend",
                runId: "backend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
                sequence: 0,
                data: "Dev server exited with code 1.\r\n",
                timestamp: "2026-03-19T15:30:00.000Z",
              },
            ],
          }),
        ],
      });

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings: {
              ...repoSettings,
              devServers: [
                { id: "frontend", name: "Frontend", command: "bun run dev" },
                { id: "backend", name: "Backend", command: "bun run api" },
              ],
            },
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("stopped");
      });

      act(() => {
        getLatest().onStart();
      });

      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });
      expect(getLatest().error).toBeNull();
      expect(getLatest().scripts.map((script) => script.status)).toEqual(["running", "failed"]);
      expect(getLatest().selectedScript?.scriptId).toBe("frontend");
      expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("ready\r\n");
    } finally {
      view.unmount();
    }
  });

  test("stores terminal chunks in the selected script buffer without rewriting script state", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const runningState = buildState({
      scripts: [
        buildScript({
          status: "running",
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
        }),
      ],
    });
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerGetState = async () => runningState;
    devServerRestart = async () => restartDeferred.promise;

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };
    const getSelectedTerminalData = (): string | undefined => {
      const selectedTerminalBuffer = getLatest().selectedScriptTerminalBuffer;
      if (!selectedTerminalBuffer) {
        return undefined;
      }

      return selectedTerminalBuffer.entries[0]?.data;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });

      await act(async () => {
        getLatest().onRestart();
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 0,
            data: "\u001b[32mready\u001b[0m\r\n",
            timestamp: "2026-03-19T15:30:01.000Z",
          },
        });
      });

      restartDeferred.resolve(runningState);

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries.length).toBe(1);
      });
      expect(getLatest().selectedScript?.bufferedTerminalChunks).toHaveLength(0);
      expect(getSelectedTerminalData()).toBe("\u001b[32mready\u001b[0m\r\n");
    } finally {
      view.unmount();
    }
  });

  test("preserves newer streamed terminal chunks when mutation state syncs stale query data", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const runningState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
        }),
      ],
    });

    devServerGetState = async () => runningState;
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };
    const getSelectedTerminalData = (): string | undefined => {
      const selectedTerminalBuffer = getLatest().selectedScriptTerminalBuffer;
      if (!selectedTerminalBuffer) {
        return undefined;
      }

      return selectedTerminalBuffer.entries[0]?.data;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });

      await act(async () => {
        getLatest().onRestart();
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 0,
            data: "fresh-line",
            timestamp: "2026-03-19T15:30:01.000Z",
          },
        });
      });

      await waitFor(() => {
        expect(getSelectedTerminalData()).toBe("fresh-line");
      });

      restartDeferred.resolve(runningState);

      await waitFor(() => {
        expect(getLatest().isRestartPending).toBe(false);
      });
      expect(getSelectedTerminalData()).toBe("fresh-line");
    } finally {
      view.unmount();
    }
  });

  test("preserves live shutdown output when a stop mutation returns an empty replay", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const runningState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 0,
              data: "ready\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const stoppedState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "stopped",
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
          pid: null,
          startedAt: null,
          bufferedTerminalChunks: [],
        }),
      ],
    });
    const stoppedScript = stoppedState.scripts[0];
    if (!stoppedScript) {
      throw new Error("Expected stopped dev server script fixture.");
    }
    const stopDeferred = createDeferred<DevServerGroupState>();
    devServerGetState = async () => runningState;
    devServerStop = async () => stopDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });
    const getLatest = harness.getLatest;

    try {
      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("ready\r\n");
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        getLatest().onStop();
      });

      await act(async () => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 1,
            data: "closing dev server\r\n",
            timestamp: "2026-03-19T15:30:01.000Z",
          },
        });
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:30:02.000Z",
          script: stoppedScript,
        });
      });

      await waitFor(() => {
        expect(
          getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
        ).toEqual(["closing dev server\r\n"]);
      });

      stopDeferred.resolve(stoppedState);

      await waitFor(() => {
        expect(getLatest().isStopPending).toBe(false);
      });
      expect(getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data)).toEqual([
        "closing dev server\r\n",
      ]);
      expect(getLatest().scripts[0]?.status).toBe("stopped");
    } finally {
      harness.unmount();
    }
  });

  test("replaces mixed old and new replay when mutation state returns the reset window", async () => {
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
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 3,
              data: "old run output\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const restartedState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          runId: "frontend:2",
          runOrder: { hostInstanceId: "host-1", generation: 2 },
          pid: 4343,
          startedAt: "2026-03-19T15:31:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runId: "frontend:2",
              runOrder: { hostInstanceId: "host-1", generation: 2 },
              sequence: 4,
              data: "new run output\r\n",
              timestamp: "2026-03-19T15:31:01.000Z",
            },
          ],
        }),
      ],
    });

    devServerGetState = async () => initialState;
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "old run output\r\n",
        );
      });

      await act(async () => {
        getLatest().onRestart();
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            sequence: 4,
            data: "new run output\r\n",
            timestamp: "2026-03-19T15:31:01.000Z",
          },
        });
      });

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(1);
      });

      restartDeferred.resolve(restartedState);

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(1);
      });
      expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("new run output\r\n");
      expect(getLatest().isRestartPending).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test("does not reuse cached dev-server state across subscription sessions", async () => {
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
      updatedAt: "2026-03-19T15:35:00.000Z",
      scripts: [
        buildScript({
          status: "failed",
          lastError: "Dev server exited with code 1.",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 1,
              data: "Dev server exited with code 1.\r\n",
              timestamp: "2026-03-19T15:35:00.000Z",
            },
          ],
        }),
      ],
    });
    const reopenFetch = createDeferred<DevServerGroupState>();
    let phase: "initial" | "reopen" = "initial";

    devServerGetState = async () => {
      if (phase === "reopen") {
        return reopenFetch.promise;
      }

      return initialState;
    };

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);

      return null;
    };

    let currentArgs: HookArgs = {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness args={currentArgs} />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });
      expect(getLatest().scripts[0]?.status).toBe("running");

      currentArgs = { ...currentArgs, enabled: false };
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness args={currentArgs} />
        </QueryProvider>,
      );
      await waitFor(() => {
        expect(getLatest().scripts).toHaveLength(0);
      });

      phase = "reopen";
      currentArgs = { ...currentArgs, enabled: true };
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness args={currentArgs} />
        </QueryProvider>,
      );

      await waitFor(() => {
        expect(getLatest().scripts).toHaveLength(0);
        expect(getLatest().mode).toBe("loading");
        expect(getLatest().isLoading).toBe(true);
      });

      reopenFetch.resolve(refreshedState);

      await waitFor(() => {
        expect(getLatest().scripts[0]?.status).toBe("failed");
      });
      expect(getLatest().mode).toBe("active");
      expect(getLatest().selectedScript?.lastError).toBe("Dev server exited with code 1.");
    } finally {
      view.unmount();
    }
  });

  test("reconciles terminal replay from a normal state refetch when local buffers are already populated", async () => {
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
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
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
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 1,
              data: "fresh output\r\n",
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

    let latest: HookResult | null = null;
    let queryClient: ReturnType<typeof useQueryClient> | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const CaptureQueryClient = () => {
      queryClient = useQueryClient();
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <CaptureQueryClient />
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("stale output\r\n");
      });

      if (queryClient === null) {
        throw new Error("Expected query client to be captured");
      }

      await act(async () => {
        await queryClient?.refetchQueries({
          queryKey: devServerQueryKeys.state("/repo", "task-7", "test:0"),
          exact: true,
          type: "active",
        });
      });

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("fresh output\r\n");
      });
      expect(getStateCalls).toBe(2);
    } finally {
      view.unmount();
    }
  });

  test("clears stale terminal replay when a normal state refetch reports an empty authoritative buffer", async () => {
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
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
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
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [],
        }),
      ],
    });
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return getStateCalls === 1 ? initialState : refreshedState;
    };

    let latest: HookResult | null = null;
    let queryClient: ReturnType<typeof useQueryClient> | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const CaptureQueryClient = () => {
      queryClient = useQueryClient();
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <CaptureQueryClient />
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("stale output\r\n");
      });

      if (queryClient === null) {
        throw new Error("Expected query client to be captured");
      }

      await act(async () => {
        await queryClient?.refetchQueries({
          queryKey: devServerQueryKeys.state("/repo", "task-7", "test:0"),
          exact: true,
          type: "active",
        });
      });

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(0);
      });
      expect(getLatest().selectedScript?.bufferedTerminalChunks).toHaveLength(0);
      expect(getStateCalls).toBe(2);
    } finally {
      view.unmount();
    }
  });

  test("drops stale replay but preserves newer live output when a refetch returns an empty authoritative buffer", async () => {
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
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
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
          pid: 4242,
          startedAt: "2026-03-19T15:30:00.000Z",
          bufferedTerminalChunks: [],
        }),
      ],
    });
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return getStateCalls === 1 ? initialState : refreshedState;
    };

    let latest: HookResult | null = null;
    let queryClient: ReturnType<typeof useQueryClient> | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const CaptureQueryClient = () => {
      queryClient = useQueryClient();
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <CaptureQueryClient />
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe("stale output\r\n");
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      await act(async () => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 1,
            data: "live output\r\n",
            timestamp: "2026-03-19T15:31:01.000Z",
          },
        });
      });

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(2);
      });

      if (queryClient === null) {
        throw new Error("Expected query client to be captured");
      }

      await act(async () => {
        await queryClient?.refetchQueries({
          queryKey: devServerQueryKeys.state("/repo", "task-7", "test:0"),
          exact: true,
          type: "active",
        });
      });

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries).toEqual([
          {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 1,
            data: "live output\r\n",
            timestamp: "2026-03-19T15:31:01.000Z",
          },
        ]);
      });
      expect(getLatest().selectedScript?.bufferedTerminalChunks).toHaveLength(0);
      expect(getStateCalls).toBe(2);
    } finally {
      view.unmount();
    }
  });

  test("preserves resumed live output after restart clears replay and later refetches stay empty", async () => {
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
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 0,
              data: "stale output\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const restartedState = buildState({
      updatedAt: "2026-03-19T15:31:00.000Z",
      scripts: [
        buildScript({
          status: "running",
          pid: 4343,
          startedAt: "2026-03-19T15:31:00.000Z",
          bufferedTerminalChunks: [],
        }),
      ],
    });
    let phase: "initial" | "restarted" = "initial";
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return phase === "initial" ? initialState : restartedState;
    };
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerRestart = async () => restartDeferred.promise;

    let latest: HookResult | null = null;
    let queryClient: ReturnType<typeof useQueryClient> | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };
    const getSelectedTerminalData = (): string | undefined => {
      const selectedTerminalBuffer = getLatest().selectedScriptTerminalBuffer;
      if (!selectedTerminalBuffer) {
        return undefined;
      }

      return selectedTerminalBuffer.entries[0]?.data;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const CaptureQueryClient = () => {
      queryClient = useQueryClient();
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <CaptureQueryClient />
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getSelectedTerminalData()).toBe("stale output\r\n");
      });

      if (queryClient === null) {
        throw new Error("Expected query client to be captured");
      }

      await act(async () => {
        getLatest().onRestart();
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      phase = "restarted";
      restartDeferred.resolve(restartedState);

      await waitFor(() => {
        expect(getLatest().selectedScriptTerminalBuffer?.entries).toHaveLength(0);
      });

      await act(async () => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 0,
            data: "new run output\r\n",
            timestamp: "2026-03-19T15:31:01.000Z",
          },
        });
      });

      await waitFor(() => {
        expect(getSelectedTerminalData()).toBe("new run output\r\n");
      });

      await act(async () => {
        await queryClient?.refetchQueries({
          queryKey: devServerQueryKeys.state("/repo", "task-7", "test:0"),
          exact: true,
          type: "active",
        });
      });

      await waitFor(() => {
        expect(getLatest().isRestartPending).toBe(false);
      });
      expect(getSelectedTerminalData()).toBe("new run output\r\n");
      expect(getStateCalls).toBe(2);
    } finally {
      view.unmount();
    }
  });

  test("clears old live-only output when restart emits a starting status before low-sequence chunks", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const initialState = buildState({
      scripts: [
        buildScript({
          status: "failed",
          pid: null,
          startedAt: "2026-03-19T15:30:00.000Z",
          lastError: "Command failed.",
          bufferedTerminalChunks: [
            {
              scriptId: "frontend",
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 0,
              data: "Starting `bun run dev`\r\n",
              timestamp: "2026-03-19T15:30:00.000Z",
            },
          ],
        }),
      ],
    });
    const restartDeferred = createDeferred<DevServerGroupState>();
    devServerGetState = async () => initialState;
    devServerRestart = async () => restartDeferred.promise;

    const harness = renderDevServerPanelHook<HookArgs, HookResult>(useAgentStudioDevServerPanel, {
      repoPath: "/repo",
      taskId: "task-7",
      repoSettings,
      enabled: true,
    });
    const getLatest = harness.getLatest;

    try {
      await waitFor(() => {
        expect(
          getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
        ).toEqual(["Starting `bun run dev`\r\n"]);
      });
      await waitFor(() => {
        expect(devServerEventListener).not.toBeNull();
      });

      act(() => {
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 1,
            data: "old failed output\r\n",
            timestamp: "2026-03-19T15:30:01.000Z",
          },
        });
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            sequence: 2,
            data: "ELIFECYCLE Command failed.\r\n",
            timestamp: "2026-03-19T15:30:02.000Z",
          },
        });
      });

      await waitFor(() => {
        expect(
          getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
        ).toEqual([
          "Starting `bun run dev`\r\n",
          "old failed output\r\n",
          "ELIFECYCLE Command failed.\r\n",
        ]);
      });

      await act(async () => {
        getLatest().onRestart();
      });
      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          repoPath: "/repo",
          taskId: "task-7",
          updatedAt: "2026-03-19T15:31:00.000Z",
          script: buildScript({
            status: "starting",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            pid: null,
            startedAt: "2026-03-19T15:31:00.000Z",
            bufferedTerminalChunks: [],
          }),
        });
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            sequence: 0,
            data: "Starting `bun run dev`\r\n",
            timestamp: "2026-03-19T15:31:00.000Z",
          },
        });
        devServerEventListener?.({
          type: "terminal_chunk",
          repoPath: "/repo",
          taskId: "task-7",
          terminalChunk: {
            scriptId: "frontend",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            sequence: 1,
            data: "new dev server ready\r\n",
            timestamp: "2026-03-19T15:31:01.000Z",
          },
        });
      });

      expect(getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data)).toEqual([
        "Starting `bun run dev`\r\n",
        "new dev server ready\r\n",
      ]);

      restartDeferred.resolve(
        buildState({
          scripts: [
            buildScript({
              status: "running",
              runId: "frontend:2",
              runOrder: { hostInstanceId: "host-1", generation: 2 },
              pid: 4343,
              startedAt: "2026-03-19T15:31:00.000Z",
              bufferedTerminalChunks: [
                {
                  scriptId: "frontend",
                  runId: "frontend:2",
                  runOrder: { hostInstanceId: "host-1", generation: 2 },
                  sequence: 0,
                  data: "Starting `bun run dev`\r\n",
                  timestamp: "2026-03-19T15:31:00.000Z",
                },
                {
                  scriptId: "frontend",
                  runId: "frontend:2",
                  runOrder: { hostInstanceId: "host-1", generation: 2 },
                  sequence: 1,
                  data: "new dev server ready\r\n",
                  timestamp: "2026-03-19T15:31:01.000Z",
                },
              ],
            }),
          ],
        }),
      );
      await waitFor(() => {
        expect(getLatest().isRestartPending).toBe(false);
      });
    } finally {
      harness.unmount();
    }
  });

  test("clears stale task state when switching to another task while enabled", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];

    const taskOneState = buildState({
      repoPath: "/repo-a",
      taskId: "task-1",
      worktreePath: "/tmp/worktree/task-1",
      scripts: [buildScript({ status: "running", pid: 1111 })],
    });
    const taskTwoFetch = createDeferred<DevServerGroupState>();
    const taskTwoState = buildState({
      repoPath: "/repo-b",
      taskId: "task-2",
      worktreePath: "/tmp/worktree/task-2",
      scripts: [buildScript({ scriptId: "backend", name: "Backend", command: "bun run api" })],
    });

    devServerGetState = async (repoPath, taskId) => {
      if (repoPath === "/repo-a" && taskId === "task-1") {
        return taskOneState;
      }
      return taskTwoFetch.promise;
    };

    let currentArgs: HookArgs = {
      repoPath: "/repo-a",
      taskId: "task-1",
      repoSettings,
      enabled: true,
    };
    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, currentArgs);

    try {
      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.pid).toBe(1111);
      });

      currentArgs = { ...currentArgs, repoPath: "/repo-b", taskId: "task-2" };
      harness.update(currentArgs);

      expect(harness.getLatest().mode).toBe("loading");
      expect(harness.getLatest().scripts).toHaveLength(0);

      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("loading");
      });
      expect(harness.getLatest().scripts).toHaveLength(0);

      taskTwoFetch.resolve(taskTwoState);

      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.scriptId).toBe("backend");
      });
      expect(harness.getLatest().worktreePath).toBe("/tmp/worktree/task-2");
    } finally {
      harness.unmount();
    }
  });

  test("shows cached dev-server state while refetching after task switch", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];

    const queryClient = createQueryClient();
    const taskOneState = buildState({
      repoPath: "/repo-a",
      taskId: "task-1",
      worktreePath: "/tmp/worktree/task-1",
      scripts: [buildScript({ status: "running", pid: 1111 })],
    });
    const cachedTaskTwoState = buildState({
      repoPath: "/repo-b",
      taskId: "task-2",
      worktreePath: "/tmp/worktree/task-2",
      scripts: [
        buildScript({
          scriptId: "backend",
          name: "Backend",
          command: "bun run api",
          status: "running",
          pid: 2221,
        }),
      ],
    });
    const freshTaskTwoState = buildState({
      repoPath: "/repo-b",
      taskId: "task-2",
      worktreePath: "/tmp/worktree/task-2",
      scripts: [
        buildScript({
          scriptId: "backend",
          name: "Backend",
          command: "bun run api",
          status: "running",
          pid: 2222,
        }),
      ],
    });
    const taskTwoFetch = createDeferred<DevServerGroupState>();
    let didStartTaskTwoFetch = false;

    queryClient.setQueryData(
      devServerQueryKeys.state("/repo-b", "task-2", "test:1"),
      cachedTaskTwoState,
      {
        updatedAt: 1,
      },
    );
    devServerGetState = async (repoPath, taskId) => {
      if (repoPath === "/repo-a" && taskId === "task-1") {
        return taskOneState;
      }

      didStartTaskTwoFetch = true;
      return taskTwoFetch.promise;
    };

    let currentArgs: HookArgs = {
      repoPath: "/repo-a",
      taskId: "task-1",
      repoSettings,
      enabled: true,
    };
    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, currentArgs, {
      queryClient,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.pid).toBe(1111);
      });

      currentArgs = { ...currentArgs, repoPath: "/repo-b", taskId: "task-2" };
      harness.update(currentArgs);

      expect(harness.getLatest().scripts).toEqual([]);
      expect(harness.getLatest().mode).toBe("loading");
      expect(harness.getLatest().isLoading).toBe(true);

      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.pid).toBe(2221);
        expect(didStartTaskTwoFetch).toBe(true);
      });
      expect(harness.getLatest().mode).toBe("active");
      expect(harness.getLatest().isLoading).toBe(false);

      taskTwoFetch.resolve(freshTaskTwoState);
      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.pid).toBe(2222);
      });
    } finally {
      harness.unmount();
      queryClient.clear();
    }
  });

  test("surfaces restart failures without promoting them to fatal action crashes", async () => {
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
    devServerRestart = async () => {
      throw new Error("Dev server exited with code 1.");
    };

    let latest: HookResult | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useAgentStudioDevServerPanel(args);
      return null;
    };

    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness
          args={{
            repoPath: "/repo",
            taskId: "task-7",
            repoSettings,
            enabled: true,
          }}
        />
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });

      act(() => {
        getLatest().onRestart();
      });

      await waitFor(() => {
        expect(getLatest().error).toBe("Dev server exited with code 1.");
      });
      expect(getLatest().isRestartPending).toBe(false);
    } finally {
      view.unmount();
    }
  });
});

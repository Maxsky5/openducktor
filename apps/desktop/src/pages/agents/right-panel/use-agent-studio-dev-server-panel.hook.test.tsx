import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import { act, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { RepoSettingsInput } from "@/types/state-slices";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

const buildScript = (overrides: Partial<DevServerScriptState> = {}): DevServerScriptState => ({
  scriptId: "frontend",
  name: "Frontend",
  command: "bun run dev",
  status: "stopped",
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [],
  ...overrides,
});

const buildState = (overrides: Partial<DevServerGroupState> = {}): DevServerGroupState => ({
  repoPath: "/repo",
  taskId: "task-7",
  worktreePath: "/tmp/worktree/task-7",
  scripts: [buildScript()],
  updatedAt: "2026-03-19T15:30:00.000Z",
  ...overrides,
});

const repoSettings: RepoSettingsInput = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  trustedHooks: true,
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
};

let devServerGetState = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerStart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerStop = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerRestart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
  buildState();
let devServerEventListener: ((payload: unknown) => void) | null = null;

mock.module("@/lib/host-client", () => ({
  hostClient: {
    devServerGetState: (...args: [string, string]) => devServerGetState(...args),
    devServerStart: (...args: [string, string]) => devServerStart(...args),
    devServerStop: (...args: [string, string]) => devServerStop(...args),
    devServerRestart: (...args: [string, string]) => devServerRestart(...args),
  },
  subscribeDevServerEvents: async (listener: (payload: unknown) => void) => {
    devServerEventListener = listener;
    return () => {
      devServerEventListener = null;
    };
  },
}));

beforeEach(() => {
  devServerGetState = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerStart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerStop = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerRestart = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  devServerEventListener = null;
});

afterAll(async () => {
  await restoreMockedModules([["@/lib/host-client", () => import("@/lib/host-client")]]);
});

describe("useAgentStudioDevServerPanel", () => {
  test("subscribes to dev-server events while enabled so startup events are not missed", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

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
      expect(devServerEventListener).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

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
      expect(getStateCalls).toBe(0);
      expect(devServerEventListener).toBeNull();
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

  test("reopens in loading mode until a fresh dev-server refetch completes", async () => {
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
              sequence: 1,
              data: "Dev server exited with code 1.\r\n",
              timestamp: "2026-03-19T15:35:00.000Z",
            },
          ],
        }),
      ],
    });
    const reopenFetch = createDeferred<DevServerGroupState>();
    let phase: "initial" | "reopen" | "steady" = "initial";

    devServerGetState = async () => {
      if (phase === "reopen") {
        return reopenFetch.promise;
      }

      if (phase === "steady") {
        return refreshedState;
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
        expect(getLatest().mode).toBe("loading");
      });
      expect(getLatest().isLoading).toBe(true);
      expect(getLatest().scripts).toHaveLength(0);

      phase = "steady";
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

  test("clears stale task state when switching to another task while enabled", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

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
      repoPath: "/repo-a",
      taskId: "task-1",
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
        expect(getLatest().scripts[0]?.pid).toBe(1111);
      });

      currentArgs = { ...currentArgs, repoPath: "/repo-b", taskId: "task-2" };
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness args={currentArgs} />
        </QueryProvider>,
      );

      await waitFor(() => {
        expect(getLatest().mode).toBe("loading");
      });
      expect(getLatest().scripts).toHaveLength(0);

      taskTwoFetch.resolve(taskTwoState);

      await waitFor(() => {
        expect(getLatest().scripts[0]?.scriptId).toBe("backend");
      });
      expect(getLatest().worktreePath).toBe("/tmp/worktree/task-2");
    } finally {
      view.unmount();
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

      await act(async () => {
        getLatest().onRestart();
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
        expect(getLatest().selectedScriptTerminalBuffer?.entries[0]?.data).toBe(
          "rehydrated output\r\n",
        );
      });
      expect(getStateCalls).toBe(2);
      restartDeferred.resolve(refreshedState);
    } finally {
      view.unmount();
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
    const originalConsoleError = console.error;
    console.error = () => {};

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

      act(() => {
        devServerEventListener?.({ type: "terminal_chunk", repoPath: "/repo", taskId: "task-7" });
      });

      await waitFor(() => {
        expect(getLatest().error).toContain("Received invalid dev server event payload");
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
      view.unmount();
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

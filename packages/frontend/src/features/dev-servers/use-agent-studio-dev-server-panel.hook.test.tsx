import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { act, render, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
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
let nextSubscriptionTransportEpoch = 0;
let subscribeDevServerEventsMock = async (
  listener: DevServerEventListener,
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
  nextSubscriptionTransportEpoch = 0;
  subscribeDevServerEventsMock = async (listener: DevServerEventListener) => {
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

describe("useAgentStudioDevServerPanel", () => {
  test("shows the settings hint when the host reports no scripts", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return buildState({ scripts: [] });
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
            owner: { kind: "task", taskId: "task-7" },
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
        "Add dev server scripts in repository settings to run them here.",
      );
      expect(getStateCalls).toBeGreaterThan(0);
      expect(devServerEventListener).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows a Workspace Session's output terminal until the server stops", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    const owner: DevServerOwner = {
      kind: "workspace_session",
      workspaceId: "workspace-1",
      sessionId: "session-1",
    };
    const runningState = buildState({
      owner,
      workingDirectory: "/repo",
      revision: 2,
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          terminalId: "terminal-output",
        }),
      ],
    });
    const stoppedOwners: DevServerOwner[] = [];
    devServerGetState = async () => runningState;
    devServerStop = async (_repoPath, stoppedOwner) => {
      stoppedOwners.push(stoppedOwner);
      return buildState({ owner, workingDirectory: "/repo", scripts: [], revision: 3 });
    };
    const initialArgs = { repoPath: "/repo", owner, enabled: true };
    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, initialArgs);

    try {
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("active");
        expect(harness.getLatest().scripts[0]?.status).toBe("running");
        expect(harness.getLatest().selectedScript?.terminalId).toBe("terminal-output");
      });
      expect(devServerEventListener).not.toBeNull();
      await act(async () => harness.getLatest().onStop());
      await waitFor(() => {
        expect(stoppedOwners).toEqual([owner]);
        expect(harness.getLatest().mode).toBe("empty");
      });
    } finally {
      harness.unmount();
    }
  });

  test("returns a disabled reason when a builder worktree is unavailable", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    devServerGetState = async () =>
      buildState({
        workingDirectory: null,
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
            owner: { kind: "task", taskId: "task-7" },
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
            owner: { kind: "task", taskId: "task-7" },
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
            owner: { kind: "task", taskId: "task-7" },
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
          revision: 1,
          repoPath: "/repo",
          owner: { kind: "task", taskId: "task-7" },
          updatedAt: "2026-03-19T15:30:00.000Z",
          script: buildScript({
            status: "starting",
            terminalId: "terminal-output",
          }),
        });
      });

      await waitFor(() => {
        expect(getLatest().mode).toBe("active");
      });
      expect(getLatest().scripts[0]?.status).toBe("starting");
      expect(getLatest().selectedScript?.terminalId).toBe("terminal-output");

      startDeferred.resolve(
        buildState({
          scripts: [
            buildScript({
              status: "running",
              pid: 4242,
              startedAt: "2026-03-19T15:30:00.000Z",
              terminalId: "terminal-output",
            }),
          ],
        }),
      );
    } finally {
      view.unmount();
    }
  });

  test("keeps a stopped run terminal until the host reports a new run", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const stoppedState = buildState({
      scripts: [
        buildScript({
          terminalId: "terminal-output",
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
            owner: { kind: "task", taskId: "task-7" },
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

      expect(getLatest().selectedScript?.terminalId).toBe("terminal-output");
      await waitFor(() => {
        expect(startCalls).toBe(1);
        expect(getLatest().mode).toBe("active");
        expect(getLatest().isExpanded).toBe(true);
      });

      act(() => {
        devServerEventListener?.({
          type: "script_status_changed",
          revision: 1,
          repoPath: "/repo",
          owner: { kind: "task", taskId: "task-7" },
          updatedAt: "2026-03-19T15:31:00.000Z",
          script: buildScript({
            status: "starting",
            terminalId: "terminal-next",
          }),
        });
      });

      expect(getLatest().scripts[0]?.status).toBe("starting");
      expect(getLatest().selectedScript?.terminalId).toBe("terminal-next");
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
            terminalId: "terminal-output",
          }),
          buildScript({
            scriptId: "backend",
            name: "Backend",
            command: "bun run api",
            status: "failed",
            lastError: "Dev server exited with code 1.",
            exitCode: 1,
            terminalId: "terminal-output",
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
            owner: { kind: "task", taskId: "task-7" },
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
      expect(getLatest().selectedScript?.terminalId).toBe("terminal-output");
    } finally {
      view.unmount();
    }
  });

  test("shows cached dev-server state while a reopened subscription loads fresh state", async () => {
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
          terminalId: "terminal-output",
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
      owner: { kind: "task", taskId: "task-7" },
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
        expect(getLatest().scripts[0]?.status).toBe("running");
        expect(getLatest().mode).toBe("active");
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

  test("clears stale task state when switching to another task while enabled", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];

    const taskOneState = buildState({
      repoPath: "/repo-a",
      owner: { kind: "task", taskId: "task-1" },
      workingDirectory: "/tmp/worktree/task-1",
      scripts: [buildScript({ status: "running", pid: 1111 })],
    });
    const taskTwoFetch = createDeferred<DevServerGroupState>();
    const taskTwoState = buildState({
      repoPath: "/repo-b",
      owner: { kind: "task", taskId: "task-2" },
      workingDirectory: "/tmp/worktree/task-2",
      scripts: [buildScript({ scriptId: "backend", name: "Backend", command: "bun run api" })],
    });

    devServerGetState = async (repoPath, taskId) => {
      if (repoPath === "/repo-a" && taskId.kind === "task" && taskId.taskId === "task-1") {
        return taskOneState;
      }
      return taskTwoFetch.promise;
    };

    let currentArgs: HookArgs = {
      repoPath: "/repo-a",
      owner: { kind: "task", taskId: "task-1" },
      enabled: true,
    };
    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, currentArgs);

    try {
      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.pid).toBe(1111);
      });

      currentArgs = {
        ...currentArgs,
        repoPath: "/repo-b",
        owner: { kind: "task", taskId: "task-2" },
      };
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
      expect(harness.getLatest().workingDirectory).toBe("/tmp/worktree/task-2");
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
      owner: { kind: "task", taskId: "task-1" },
      workingDirectory: "/tmp/worktree/task-1",
      scripts: [buildScript({ status: "running", pid: 1111 })],
    });
    const cachedTaskTwoState = buildState({
      repoPath: "/repo-b",
      owner: { kind: "task", taskId: "task-2" },
      workingDirectory: "/tmp/worktree/task-2",
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
      owner: { kind: "task", taskId: "task-2" },
      workingDirectory: "/tmp/worktree/task-2",
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
      devServerQueryKeys.state("/repo-b", { kind: "task", taskId: "task-2" }, "test:1"),
      cachedTaskTwoState,
      {
        updatedAt: 1,
      },
    );
    devServerGetState = async (repoPath, taskId) => {
      if (repoPath === "/repo-a" && taskId.kind === "task" && taskId.taskId === "task-1") {
        return taskOneState;
      }

      didStartTaskTwoFetch = true;
      return taskTwoFetch.promise;
    };

    let currentArgs: HookArgs = {
      repoPath: "/repo-a",
      owner: { kind: "task", taskId: "task-1" },
      enabled: true,
    };
    const harness = renderDevServerPanelHook(useAgentStudioDevServerPanel, currentArgs, {
      queryClient,
    });

    try {
      await waitFor(() => {
        expect(harness.getLatest().scripts[0]?.pid).toBe(1111);
      });

      currentArgs = {
        ...currentArgs,
        repoPath: "/repo-b",
        owner: { kind: "task", taskId: "task-2" },
      };
      harness.update(currentArgs);

      expect(harness.getLatest().scripts[0]?.pid).toBe(2221);
      expect(harness.getLatest().mode).toBe("active");
      expect(harness.getLatest().isExpanded).toBe(true);
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

  test("keeps each running Workspace Session panel visible on repeat switches", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    const firstOwner: DevServerOwner = {
      kind: "workspace_session",
      workspaceId: "workspace-1",
      sessionId: "session-1",
    };
    const secondOwner: DevServerOwner = {
      kind: "workspace_session",
      workspaceId: "workspace-1",
      sessionId: "session-2",
    };
    const firstState = buildState({
      repoPath: "/repo",
      owner: firstOwner,
      workingDirectory: "/repo",
      scripts: [buildScript({ status: "running", pid: 1111 })],
    });
    const secondState = buildState({
      repoPath: "/repo",
      owner: secondOwner,
      workingDirectory: "/repo",
      scripts: [buildScript({ status: "running", pid: 2222 })],
    });
    devServerGetState = async (_repoPath, owner) =>
      owner.kind === "workspace_session" && owner.sessionId === "session-1"
        ? firstState
        : secondState;
    let latest: ReturnType<typeof useAgentStudioDevServerPanel> | null = null;
    const Panel = ({ owner }: { owner: DevServerOwner }) => {
      latest = useAgentStudioDevServerPanel({ repoPath: "/repo", owner, enabled: true });
      return null;
    };
    const getLatest = () => {
      if (!latest) throw new Error("Panel state not ready");
      return latest;
    };
    const show = (owner: DevServerOwner) => (
      <QueryProvider useIsolatedClient>
        <Panel
          key={owner.kind === "workspace_session" ? owner.sessionId : owner.taskId}
          owner={owner}
        />
      </QueryProvider>
    );
    const view = render(show(firstOwner));

    try {
      await waitFor(() => expect(getLatest().scripts[0]?.pid).toBe(1111));
      view.rerender(show(secondOwner));
      await waitFor(() => expect(getLatest().scripts[0]?.pid).toBe(2222));

      view.rerender(show(firstOwner));
      expect(getLatest().mode).toBe("active");
      expect(getLatest().scripts[0]?.pid).toBe(1111);

      view.rerender(show(secondOwner));
      expect(getLatest().mode).toBe("active");
      expect(getLatest().scripts[0]?.pid).toBe(2222);
    } finally {
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
            owner: { kind: "task", taskId: "task-7" },
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

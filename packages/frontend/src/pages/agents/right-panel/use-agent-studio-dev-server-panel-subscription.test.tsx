import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState } from "@openducktor/contracts";
import { act, waitFor } from "@testing-library/react";
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
let subscribeDevServerEventsMock = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  devServerEventListener = listener;
  return () => {
    devServerEventListener = null;
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
  subscribeDevServerEventsMock = async (listener: (payload: unknown) => void) => {
    devServerEventListener = listener;
    return () => {
      devServerEventListener = null;
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

  test("rehydrates full buffered terminal replay when the dev-server subscription first becomes ready", async () => {
    const { useAgentStudioDevServerPanel } = await import("./use-agent-studio-dev-server-panel");
    type HookArgs = Parameters<typeof useAgentStudioDevServerPanel>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerPanel>;

    const bufferedTerminalChunks = Array.from({ length: 300 }, (_, sequence) => ({
      scriptId: "frontend",
      sequence,
      data: `subscription-gap output ${sequence}\r\n`,
      timestamp: "2026-03-19T15:31:00.000Z",
    }));
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
          bufferedTerminalChunks,
        }),
      ],
    });
    let getStateCalls = 0;
    devServerGetState = async () => {
      getStateCalls += 1;
      return getStateCalls === 1 ? initialState : refreshedState;
    };
    const subscriptionReady = createDeferred<() => void>();
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
      await waitFor(() => {
        expect(harness.getLatest().mode).toBe("active");
      });
      expect(getStateCalls).toBe(1);

      subscriptionReady.resolve(() => {
        devServerEventListener = null;
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
      expect(getStateCalls).toBe(2);
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

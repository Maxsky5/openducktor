import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import { act, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/lib/query-provider";
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
  bufferedLogLines: [],
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

describe("useAgentStudioDevServerPanel", () => {
  test("does not subscribe to dev-server events while every script is stopped", async () => {
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
      expect(devServerEventListener).toBeNull();
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
          bufferedLogLines: [
            {
              scriptId: "frontend",
              stream: "system",
              text: "Dev server exited with code 1.",
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

      act(() => {
        devServerEventListener?.({ type: "log_line", repoPath: "/repo", taskId: "task-7" });
      });

      await waitFor(() => {
        expect(getLatest().error).toContain("Received invalid dev server event payload");
      });
    } finally {
      console.error = originalConsoleError;
      view.unmount();
    }
  });
});

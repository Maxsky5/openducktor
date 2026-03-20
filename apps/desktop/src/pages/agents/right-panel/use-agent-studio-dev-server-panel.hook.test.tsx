import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryProvider } from "@/lib/query-provider";
import type { RepoSettingsInput } from "@/types/state-slices";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const flushEffects = async (): Promise<void> => {
  await act(async () => {
    await flush();
  });
};

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
let _subscribedDevServerListener: ((payload: unknown) => void) | null = null;

mock.module("@/lib/host-client", () => ({
  hostClient: {
    devServerGetState: (...args: [string, string]) => devServerGetState(...args),
    devServerStart: async () => buildState(),
    devServerStop: async () => buildState(),
    devServerRestart: async () => buildState(),
  },
  subscribeDevServerEvents: async (listener: (payload: unknown) => void) => {
    _subscribedDevServerListener = listener;
    return () => {
      _subscribedDevServerListener = null;
    };
  },
}));

beforeEach(() => {
  devServerGetState = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
  _subscribedDevServerListener = null;
});

describe("useAgentStudioDevServerPanel", () => {
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
      activeSession: null,
      enabled: true,
    };
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    try {
      await act(async () => {
        renderer = TestRenderer.create(
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(Harness, { args: currentArgs }),
          ),
        );
      });
      await flushEffects();
      await flushEffects();

      expect(getLatest().mode).toBe("active");
      expect(getLatest().scripts[0]?.status).toBe("running");

      currentArgs = { ...currentArgs, enabled: false };
      await act(async () => {
        renderer?.update(
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(Harness, { args: currentArgs }),
          ),
        );
      });
      await flushEffects();

      phase = "reopen";
      currentArgs = { ...currentArgs, enabled: true };
      await act(async () => {
        renderer?.update(
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(Harness, { args: currentArgs }),
          ),
        );
      });
      await flushEffects();

      expect(getLatest().mode).toBe("loading");
      expect(getLatest().isLoading).toBe(true);
      expect(getLatest().scripts).toHaveLength(0);

      phase = "steady";
      reopenFetch.resolve(refreshedState);
      await flushEffects();
      await flushEffects();

      expect(getLatest().mode).toBe("active");
      expect(getLatest().scripts[0]?.status).toBe("failed");
      expect(getLatest().selectedScript?.lastError).toBe("Dev server exited with code 1.");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });
});

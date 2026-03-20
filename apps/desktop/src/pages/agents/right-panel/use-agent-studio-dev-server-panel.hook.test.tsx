import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import { render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/lib/query-provider";
import type { RepoSettingsInput } from "@/types/state-slices";

GlobalRegistrator.register();

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

mock.module("@/lib/host-client", () => ({
  hostClient: {
    devServerGetState: (...args: [string, string]) => devServerGetState(...args),
    devServerStart: async () => buildState(),
    devServerStop: async () => buildState(),
    devServerRestart: async () => buildState(),
  },
  subscribeDevServerEvents: async () => () => {},
}));

beforeEach(() => {
  devServerGetState = async (_repoPath: string, _taskId: string): Promise<DevServerGroupState> =>
    buildState();
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
});

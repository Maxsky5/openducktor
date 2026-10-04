import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeCheck,
  type TaskStoreCheck,
} from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type { ScheduleTask } from "@/lib/scheduling";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createDeferred,
  createTaskStoreCheckFixture,
  type TaskStoreCheckFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { DiagnosticsToastApi } from "./use-check-diagnostics-effects";
import { useChecks } from "./use-checks";

const reactActEnvironment: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const makeRuntimeCheck = (overrides: Partial<RuntimeCheck> = {}): RuntimeCheck => ({
  pathOk: true,
  gitOk: true,
  gitVersion: "2.45.0",
  runtimes: [{ kind: "opencode", ok: true, executablePath: "/bin/opencode", version: "0.12.0" }],
  errors: [],
  ...overrides,
});

const makeTaskStoreCheck = (overrides: TaskStoreCheckFixtureOverrides = {}): TaskStoreCheck =>
  createTaskStoreCheckFixture({}, overrides);

const toastMessage = mock(
  (_message: string, _options?: { description?: string; id?: string; duration?: number }) => {},
);
const toastError = mock(
  (_message: string, _options?: { description?: string; id?: string; duration?: number }) => {},
);
const toastDismiss = mock((_toastId?: string | number) => {});
const testToastApi: DiagnosticsToastApi = {
  error: (message, options) => toastError(message, options),
  dismiss: (toastId) => toastDismiss(toastId),
};
let runtimeCheckHandler = async (_force?: boolean): Promise<RuntimeCheck> => makeRuntimeCheck();
let taskStoreCheckHandler = async (_repoPath: string): Promise<TaskStoreCheck> =>
  makeTaskStoreCheck();
const runtimeCheckMock = mock((force?: boolean) => runtimeCheckHandler(force));
const taskStoreCheckMock = mock((repoPath: string) => taskStoreCheckHandler(repoPath));
const refreshHostRuntimeStatusMock = mock(async () => {});
const hostMcpBridgeCheckMock = mock(async () => ({
  state: "ready" as const,
  hostUrl: "http://127.0.0.1:1",
  checkedAt: "2026-02-22T08:00:00.000Z",
  detail: null,
}));

type UseChecksHook = (typeof import("./use-checks"))["useChecks"];
type HookArgs = Parameters<UseChecksHook>[0];
type HookResult = ReturnType<UseChecksHook>;
type HookHarnessArgs = Partial<HookArgs> & {
  activeRepo?: string | null;
};
type ResolvedHookArgs = HookArgs &
  Required<
    Pick<
      HookArgs,
      | "runtimeCheck"
      | "taskStoreCheck"
      | "toastApi"
      | "refreshHostRuntimeStatus"
      | "hostMcpBridgeCheck"
    >
  >;

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const buildHookArgs = (
  args: Partial<HookHarnessArgs>,
  previous?: ResolvedHookArgs,
): ResolvedHookArgs => {
  const activeWorkspace =
    args.activeWorkspace !== undefined
      ? args.activeWorkspace
      : args.activeRepo !== undefined
        ? args.activeRepo
          ? createActiveWorkspace(args.activeRepo)
          : null
        : previous?.activeWorkspace;
  const runtimeDefinitions =
    args.runtimeDefinitions !== undefined ? args.runtimeDefinitions : previous?.runtimeDefinitions;

  if (activeWorkspace === undefined || runtimeDefinitions === undefined) {
    throw new Error("Hook args must include activeWorkspace and runtimeDefinitions");
  }

  return {
    ...previous,
    ...args,
    activeWorkspace,
    runtimeDefinitions,
    runtimeCheck: args.runtimeCheck ?? previous?.runtimeCheck ?? runtimeCheckMock,
    taskStoreCheck: args.taskStoreCheck ?? previous?.taskStoreCheck ?? taskStoreCheckMock,
    toastApi: args.toastApi ?? previous?.toastApi ?? testToastApi,
    refreshHostRuntimeStatus:
      args.refreshHostRuntimeStatus ??
      previous?.refreshHostRuntimeStatus ??
      refreshHostRuntimeStatusMock,
    hostMcpBridgeCheck:
      args.hostMcpBridgeCheck ?? previous?.hostMcpBridgeCheck ?? hostMcpBridgeCheckMock,
  };
};

const createHookHarness = (initialArgs: HookHarnessArgs) => {
  let latest: HookResult | null = null;
  let currentArgs = buildHookArgs(initialArgs);

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useChecks(args);
    return null;
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryProvider useIsolatedClient>{children}</QueryProvider>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    updateArgs: async (nextArgs: Partial<HookHarnessArgs>) => {
      currentArgs = buildHookArgs(nextArgs, currentArgs);
      await sharedHarness.update({ args: currentArgs });
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      const hook = latest;
      if (!hook) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(hook);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    waitFor: async (predicate: (value: HookResult) => boolean, timeoutMs?: number) => {
      await sharedHarness.waitFor(() => latest !== null && predicate(latest), timeoutMs ?? 5000);
    },
    unmount: async () => {
      try {
        await sharedHarness.unmount();
      } finally {
        latest = null;
      }
    },
  };
};

type HookHarness = ReturnType<typeof createHookHarness>;

const waitForInitialChecksToSettle = async (harness: HookHarness) => {
  await harness.mount();
  await harness.waitFor((value) => {
    return (
      value.runtimeCheck.data !== null &&
      value.taskStoreCheck.data !== null &&
      value.hostMcpBridgeCheck.data !== null
    );
  });
};

beforeEach(async () => {
  toastMessage.mockClear();
  toastError.mockClear();
  toastDismiss.mockClear();
  runtimeCheckMock.mockClear();
  taskStoreCheckMock.mockClear();
  refreshHostRuntimeStatusMock.mockClear();
  hostMcpBridgeCheckMock.mockClear();
  runtimeCheckHandler = async (_force?: boolean) => makeRuntimeCheck();
  taskStoreCheckHandler = async (_repoPath: string) => makeTaskStoreCheck();
});

describe("use-checks", () => {
  test("refreshChecks reruns host checks without a workspace", async () => {
    const harness = createHookHarness({
      activeRepo: null,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.hostMcpBridgeCheck.data !== null);
      runtimeCheckMock.mockClear();
      hostMcpBridgeCheckMock.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(refreshHostRuntimeStatusMock).toHaveBeenCalledTimes(1);
      expect(runtimeCheckMock.mock.calls).toEqual([[true]]);
      expect(hostMcpBridgeCheckMock).toHaveBeenCalledTimes(1);
      expect(taskStoreCheckMock).not.toHaveBeenCalled();
      expect(harness.getLatest().checksRepoPath).toBeNull();
      expect(harness.getLatest().isRefreshingChecks).toBe(false);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("refreshChecks reports each failed probe in its own state without throwing", async () => {
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await waitForInitialChecksToSettle(harness);
      hostMcpBridgeCheckMock.mockImplementationOnce(async () => {
        throw new Error("bridge down");
      });
      runtimeCheckHandler = async () => {
        throw new Error("runtime down");
      };
      await harness.run(async (value) => {
        await value.refreshChecks();
      });
      await harness.waitFor(
        (value) =>
          value.hostMcpBridgeCheck.error === "bridge down" &&
          value.runtimeCheck.failureKind === "error",
      );

      expect(refreshHostRuntimeStatusMock).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().taskStoreCheck.data?.taskStoreOk).toBe(true);
      expect(harness.getLatest().isRefreshingChecks).toBe(false);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("exposes each failed refresh error while it keeps the earlier observed result", async () => {
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await waitForInitialChecksToSettle(harness);
      const initial = harness.getLatest();
      expect(initial.runtimeCheck.error).toBeNull();
      expect(initial.taskStoreCheck.error).toBeNull();
      expect(initial.runtimeCheck.observedAt).not.toBeNull();
      expect(initial.taskStoreCheck.observedAt).not.toBeNull();

      runtimeCheckHandler = async () => {
        throw new Error("runtime down");
      };
      taskStoreCheckHandler = async () => {
        throw new Error("task store down");
      };
      hostMcpBridgeCheckMock.mockImplementationOnce(async () => {
        throw new Error("bridge down");
      });
      await harness.run(async (value) => {
        await value.refreshChecks();
      });
      await harness.waitFor(
        (value) =>
          value.runtimeCheck.error === "runtime down" &&
          value.taskStoreCheck.error === "task store down" &&
          value.hostMcpBridgeCheck.error === "bridge down",
      );

      const latest = harness.getLatest();
      expect(latest.runtimeCheck.failureKind).toBe("error");
      expect(latest.taskStoreCheck.failureKind).toBe("error");
      expect(latest.runtimeCheck.data).toEqual(makeRuntimeCheck());
      expect(latest.taskStoreCheck.data).toEqual(makeTaskStoreCheck());
      expect(latest.hostMcpBridgeCheck.data?.state).toBe("ready");
      expect(latest.runtimeCheck.observedAt).toBe(initial.runtimeCheck.observedAt);
      expect(latest.taskStoreCheck.observedAt).toBe(initial.taskStoreCheck.observedAt);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("refreshChecks forces one new runtime check", async () => {
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> =>
      makeRuntimeCheck(),
    );

    runtimeCheckHandler = runtimeCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      runtimeCheck.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(1);
      expect(runtimeCheck.mock.calls[0]).toEqual([true]);
    } finally {
      await harness.unmount();
    }
  }, 5000);
  test("keeps the task-store result of each repository across workspace switches", async () => {
    const taskStoreCheck = mock(async (repoPath: string): Promise<TaskStoreCheck> =>
      makeTaskStoreCheck({
        taskStorePath: `${repoPath}/.openducktor/task-stores/workspace/database.sqlite`,
      }),
    );

    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          value.taskStoreCheck.data?.taskStorePath ===
          "/repo-a/.openducktor/task-stores/workspace/database.sqlite",
      );
      taskStoreCheck.mockClear();
      await harness.run(async (value) => {
        await value.refreshTaskStoreCheckForRepo("/repo-b");
      });

      expect(harness.getLatest().taskStoreCheck.data?.taskStorePath).toBe(
        "/repo-a/.openducktor/task-stores/workspace/database.sqlite",
      );
      expect(taskStoreCheck).toHaveBeenCalledTimes(1);

      await harness.updateArgs({
        activeRepo: "/repo-b",
      });
      await harness.waitFor(
        (value) =>
          value.taskStoreCheck.data?.taskStorePath ===
          "/repo-b/.openducktor/task-stores/workspace/database.sqlite",
      );
      expect(harness.getLatest().taskStoreCheck.data?.taskStorePath).toBe(
        "/repo-b/.openducktor/task-stores/workspace/database.sqlite",
      );

      taskStoreCheck.mockClear();
      await harness.run(async (value) => {
        await value.refreshTaskStoreCheckForRepo("/repo-b");
      });

      expect(taskStoreCheck).not.toHaveBeenCalled();

      // Back to the first workspace: its result shows at once, with no new check.
      await harness.updateArgs({ activeRepo: "/repo-a" });
      expect(harness.getLatest().taskStoreCheck.data?.taskStorePath).toBe(
        "/repo-a/.openducktor/task-stores/workspace/database.sqlite",
      );
      expect(taskStoreCheck).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  }, 5000);
  test("shows cli and task-store toasts for unhealthy successful payloads", async () => {
    let runtimeCallCount = 0;
    let taskStoreCallCount = 0;
    const runtimeCheck = mock(async (): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      return runtimeCallCount === 1
        ? makeRuntimeCheck()
        : makeRuntimeCheck({
            pathOk: true,
            gitOk: false,
            gitVersion: null,
            runtimes: [{ kind: "opencode", ok: false, executablePath: null, version: null }],
            errors: ["git missing"],
          });
    });
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => {
      taskStoreCallCount += 1;
      return taskStoreCallCount === 1
        ? makeTaskStoreCheck()
        : makeTaskStoreCheck({
            taskStoreOk: false,
            taskStorePath: null,
            taskStoreError: "task store offline",
            repoStoreHealth: {
              category: "database_unavailable",
              status: "blocking",
              isReady: false,
              detail: "task store offline",
              databasePath: null,
            },
          });
    });

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await waitForInitialChecksToSettle(harness);
      toastError.mockClear();

      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          description: "git missing",
        }),
      );
      expect(toastError).toHaveBeenCalledWith(
        "Task store unavailable",
        expect.objectContaining({
          id: "diagnostics:task-store",
          description: "task store offline",
        }),
      );
    } finally {
      await harness.unmount();
    }
  }, 5000);
  test("projects runtime and task-store query timeouts into concrete states instead of leaving checks pending", async () => {
    const runtimeDeferred = createDeferred<RuntimeCheck>();
    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const scheduleTask = mock<ScheduleTask>((callback, delayMs) => {
      expect(delayMs).toBe(15_000);
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          callback();
        }
      });
      return () => {
        cancelled = true;
      };
    });

    runtimeCheckHandler = mock(async () => runtimeDeferred.promise);
    taskStoreCheckHandler = mock(async () => taskStoreDeferred.promise);

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      scheduleTask,
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          value.runtimeCheck.data?.errors[0] === "Timed out after 15000ms" &&
          value.taskStoreCheck.data?.taskStoreError === "Timed out after 15000ms" &&
          value.runtimeCheck.failureKind === "timeout" &&
          value.taskStoreCheck.failureKind === "timeout",
      );

      expect(toastMessage).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      void runtimeDeferred.promise.catch(() => {});
      void taskStoreDeferred.promise.catch(() => {});
      runtimeDeferred.reject(new Error("cleanup"));
      taskStoreDeferred.reject(new Error("cleanup"));
    }
  }, 5000);
});

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
  createRepoRuntimeHealthFixture,
  createTaskStoreCheckFixture,
  type RepoRuntimeHealthFixtureOverrides,
  type TaskStoreCheckFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { DiagnosticsToastApi } from "./use-check-diagnostics-effects";
import { useChecks } from "./use-checks";

const reactActEnvironment: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const makeRuntimeCheck = (overrides: Partial<RuntimeCheck> = {}): RuntimeCheck => ({
  gitOk: true,
  gitVersion: "2.45.0",
  ghOk: true,
  ghVersion: "2.73.0",
  ghAuthOk: true,
  ghAuthLogin: "octocat",
  ghAuthError: null,
  runtimes: [{ kind: "opencode", ok: true, executablePath: "/bin/opencode", version: "0.12.0" }],
  errors: [],
  ...overrides,
});

const makeTaskStoreCheck = (overrides: TaskStoreCheckFixtureOverrides = {}): TaskStoreCheck =>
  createTaskStoreCheckFixture({}, overrides);

const makeRepoHealth = (
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({ mcp: { toolIds: ["odt_read_task"] } }, overrides);

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
const refreshRepoRuntimeHealthMock = mock(async (): Promise<RepoRuntimeHealthMap> => ({
  opencode: makeRepoHealth(),
}));

type UseChecksHook = (typeof import("./use-checks"))["useChecks"];
type HookArgs = Parameters<UseChecksHook>[0];
type HookResult = ReturnType<UseChecksHook>;
type HookHarnessArgs = Partial<HookArgs> & {
  activeRepo?: string | null;
  runtimeHealthByRuntime?: HookArgs["runtimeHealthByRuntime"];
};
type ResolvedHookArgs = HookArgs &
  Required<
    Pick<
      HookArgs,
      | "runtimeCheck"
      | "taskStoreCheck"
      | "toastApi"
      | "runtimeHealthByRuntime"
      | "isLoadingRepoRuntimeHealth"
      | "refreshRepoRuntimeHealth"
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
    runtimeHealthByRuntime: args.runtimeHealthByRuntime ??
      previous?.runtimeHealthByRuntime ?? {
        opencode: makeRepoHealth(),
      },
    isLoadingRepoRuntimeHealth:
      args.isLoadingRepoRuntimeHealth ?? previous?.isLoadingRepoRuntimeHealth ?? false,
    refreshRepoRuntimeHealth:
      args.refreshRepoRuntimeHealth ??
      previous?.refreshRepoRuntimeHealth ??
      refreshRepoRuntimeHealthMock,
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

const captureDeferredRejection = <T,>(promise: Promise<T>): Promise<T> => {
  void promise.catch(() => {});
  return promise;
};

const waitForInitialChecksToSettle = async (harness: HookHarness) => {
  await harness.mount();
  await harness.waitFor((value) => {
    return (
      value.runtimeCheck !== null &&
      value.activeTaskStoreCheck !== null &&
      value.isLoadingChecks === false
    );
  });
};

beforeEach(async () => {
  toastMessage.mockClear();
  toastError.mockClear();
  toastDismiss.mockClear();
  runtimeCheckMock.mockClear();
  taskStoreCheckMock.mockClear();
  refreshRepoRuntimeHealthMock.mockClear();
  runtimeCheckHandler = async (_force?: boolean) => makeRuntimeCheck();
  taskStoreCheckHandler = async (_repoPath: string) => makeTaskStoreCheck();
});

describe("use-checks", () => {
  test("refreshChecks is a no-op when no active repo is selected", async () => {
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> =>
      makeRuntimeCheck(),
    );
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => makeTaskStoreCheck());

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: null,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      runtimeCheck.mockClear();
      taskStoreCheck.mockClear();
      refreshRepoRuntimeHealthMock.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);

      expect(runtimeCheck).not.toHaveBeenCalled();
      expect(taskStoreCheck).not.toHaveBeenCalled();
      expect(refreshRepoRuntimeHealthMock).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("refreshRuntimeCheck caches and supports force retries", async () => {
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
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck(true);
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(1);
      expect(runtimeCheck.mock.calls[0]).toEqual([true]);
      expect(harness.getLatest().hasRuntimeCheck()).toBe(true);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("does not refresh runtime health while mounted", async () => {
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> =>
      makeRuntimeCheck(),
    );
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => makeTaskStoreCheck());
    const refreshRepoRuntimeHealth = mock(async () => ({
      opencode: makeRepoHealth(),
    }));

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
          },
          mcp: {
            supported: true,
            status: "checking",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Checking OpenDucktor MCP",
            failureKind: null,
          },
        }),
      },
      refreshRepoRuntimeHealth,
    });

    try {
      await waitForInitialChecksToSettle(harness);

      expect(refreshRepoRuntimeHealth).not.toHaveBeenCalled();

      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(refreshRepoRuntimeHealth).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("does not own runtime health loading when runtime definitions become available after mount", async () => {
    const refreshRepoRuntimeHealth = mock(async () => ({
      opencode: makeRepoHealth(),
    }));
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [],
      runtimeHealthByRuntime: {},
      refreshRepoRuntimeHealth,
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          value.runtimeCheck !== null &&
          value.activeTaskStoreCheck !== null &&
          value.isLoadingChecks === false,
      );

      expect(refreshRepoRuntimeHealth).not.toHaveBeenCalled();

      await harness.updateArgs({ runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR] });
      await harness.waitFor((value) => value.isLoadingChecks === false);

      expect(refreshRepoRuntimeHealth).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("tracks per-repo task-store cache when active repo changes", async () => {
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
          value.activeTaskStoreCheck?.taskStorePath ===
          "/repo-a/.openducktor/task-stores/workspace/database.sqlite",
      );
      taskStoreCheck.mockClear();
      await harness.run(async (value) => {
        await value.refreshTaskStoreCheckForRepo("/repo-b");
      });
      await harness.waitFor((value) => value.hasCachedTaskStoreCheck("/repo-b"));

      expect(harness.getLatest().activeTaskStoreCheck?.taskStorePath).toBe(
        "/repo-a/.openducktor/task-stores/workspace/database.sqlite",
      );
      expect(harness.getLatest().hasCachedTaskStoreCheck("/repo-b")).toBe(true);
      expect(taskStoreCheck).toHaveBeenCalledTimes(1);

      await harness.updateArgs({
        activeRepo: "/repo-b",
      });
      await harness.waitFor(
        (value) =>
          value.activeTaskStoreCheck?.taskStorePath ===
          "/repo-b/.openducktor/task-stores/workspace/database.sqlite",
      );
      expect(harness.getLatest().activeTaskStoreCheck?.taskStorePath).toBe(
        "/repo-b/.openducktor/task-stores/workspace/database.sqlite",
      );

      taskStoreCheck.mockClear();
      await harness.run(async (value) => {
        await value.refreshTaskStoreCheckForRepo("/repo-b");
      });

      expect(taskStoreCheck).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("deduplicates runtime health error toasts across manual refreshes", async () => {
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> =>
      makeRuntimeCheck(),
    );
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => makeTaskStoreCheck());
    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "mcp offline",
            failureKind: "error",
          },
        }),
      },
    });

    try {
      await waitForInitialChecksToSettle(harness);
      await harness.waitFor(() => toastError.mock.calls.length === 1);

      expect(toastError).toHaveBeenCalledWith(
        "OpenCode OpenDucktor MCP unavailable",
        expect.objectContaining({
          id: "diagnostics:mcp:opencode",
          description: "mcp offline",
        }),
      );

      toastError.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(toastError).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
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
            gitOk: false,
            gitVersion: null,
            ghOk: false,
            ghVersion: null,
            ghAuthOk: false,
            ghAuthLogin: null,
            ghAuthError: "git missing",
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

  test("refreshChecks starts independent probes in parallel", async () => {
    const runtimeDeferred = createDeferred<RuntimeCheck>();
    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const runtimeHealthDeferred = createDeferred<RepoRuntimeHealthMap>();
    let runtimeCallCount = 0;
    let taskStoreCallCount = 0;
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      return runtimeCallCount === 1 ? makeRuntimeCheck() : runtimeDeferred.promise;
    });
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => {
      taskStoreCallCount += 1;
      return taskStoreCallCount === 1 ? makeTaskStoreCheck() : taskStoreDeferred.promise;
    });
    const refreshRepoRuntimeHealth = mock(async () => runtimeHealthDeferred.promise);

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      refreshRepoRuntimeHealth,
    });

    let refreshPromise: Promise<void> | null = null;

    try {
      await waitForInitialChecksToSettle(harness);
      runtimeCheck.mockClear();
      taskStoreCheck.mockClear();

      await harness.run((value) => {
        refreshPromise = captureDeferredRejection(value.refreshChecks());
      });
      await harness.waitFor((value) => value.isLoadingChecks === true);

      expect(runtimeCheck).toHaveBeenCalledTimes(1);
      expect(runtimeCheck.mock.calls[0]).toEqual([true]);
      expect(taskStoreCheck).toHaveBeenCalledTimes(1);
      expect(refreshRepoRuntimeHealth).toHaveBeenCalledTimes(1);

      runtimeDeferred.resolve(makeRuntimeCheck());
      taskStoreDeferred.resolve(makeTaskStoreCheck());
      runtimeHealthDeferred.resolve({ opencode: makeRepoHealth() });
      await harness.run(async () => {
        await refreshPromise;
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("refreshChecks forces a fresh runtime check and surfaces errors", async () => {
    let callCount = 0;
    const runtimeCheck = mock(
      async (_force?: boolean): Promise<RuntimeCheck> =>
        new Promise((resolve, reject) => {
          callCount += 1;
          if (callCount === 1) {
            resolve(makeRuntimeCheck());
            return;
          }
          reject(new Error("runtime down"));
        }),
    );
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => makeTaskStoreCheck());

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshRuntimeCheck();
      });
      await harness.run(async (value) => {
        return expect(value.refreshChecks()).rejects.toThrow("runtime down");
      });
      await harness.waitFor(() => toastError.mock.calls.length === 1);

      expect(runtimeCheck).toHaveBeenCalledTimes(2);
      expect(runtimeCheck.mock.calls[0]).toEqual([false]);
      expect(runtimeCheck.mock.calls[1]).toEqual([true]);
      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          description: "runtime down",
        }),
      );
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("refreshChecks waits for all failed probes before surfacing unavailable diagnostics", async () => {
    const runtimeDeferred = createDeferred<RuntimeCheck>();
    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const runtimeHealthDeferred = createDeferred<RepoRuntimeHealthMap>();
    let runtimeCallCount = 0;
    let taskStoreCallCount = 0;
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      return runtimeCallCount === 1 ? makeRuntimeCheck() : runtimeDeferred.promise;
    });
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => {
      taskStoreCallCount += 1;
      return taskStoreCallCount === 1 ? makeTaskStoreCheck() : taskStoreDeferred.promise;
    });
    const refreshRepoRuntimeHealth = mock(async () => runtimeHealthDeferred.promise);

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      refreshRepoRuntimeHealth,
    });

    let refreshPromise: Promise<void> | null = null;

    try {
      await waitForInitialChecksToSettle(harness);
      runtimeCheck.mockClear();
      taskStoreCheck.mockClear();

      await harness.run((value) => {
        refreshPromise = captureDeferredRejection(value.refreshChecks());
      });
      await harness.waitFor((value) => value.isLoadingChecks === true);

      runtimeDeferred.reject(new Error("runtime down"));
      await Promise.resolve();
      expect(toastError).not.toHaveBeenCalled();

      taskStoreDeferred.reject(new Error("task store down"));
      runtimeHealthDeferred.resolve({ opencode: makeRepoHealth() });
      await harness.run(async () => {
        return expect(refreshPromise).rejects.toThrow("runtime down");
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);

      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({ id: "diagnostics:cli-tools", description: "runtime down" }),
      );
      expect(toastError).toHaveBeenCalledWith(
        "Task store unavailable",
        expect.objectContaining({
          id: "diagnostics:task-store",
          description: "task store down",
        }),
      );
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      void runtimeDeferred.promise.catch(() => {});
      void taskStoreDeferred.promise.catch(() => {});
      void runtimeHealthDeferred.promise.catch(() => {});
      runtimeDeferred.reject(new Error("cleanup"));
      taskStoreDeferred.reject(new Error("cleanup"));
      runtimeHealthDeferred.reject(new Error("cleanup"));
    }
  }, 5000);

  test("refreshChecks times out hung probes and clears loading state", async () => {
    let runtimeCallCount = 0;
    let taskStoreCallCount = 0;
    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      if (runtimeCallCount === 1) {
        return makeRuntimeCheck();
      }
      throw new Error("runtime down");
    });
    const taskStoreCheck = mock(async (): Promise<TaskStoreCheck> => {
      taskStoreCallCount += 1;
      return taskStoreCallCount === 1 ? makeTaskStoreCheck() : taskStoreDeferred.promise;
    });

    const diagnosticsTimeoutHandlers = new Set<() => void>();
    const scheduleTask = mock<ScheduleTask>((callback, delayMs) => {
      expect(delayMs).toBe(15_000);
      diagnosticsTimeoutHandlers.add(callback);
      return () => {
        diagnosticsTimeoutHandlers.delete(callback);
      };
    });

    runtimeCheckHandler = runtimeCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      scheduleTask,
    });

    let refreshPromise: Promise<void> | null = null;

    try {
      await waitForInitialChecksToSettle(harness);
      diagnosticsTimeoutHandlers.clear();
      runtimeCheck.mockClear();
      taskStoreCheck.mockClear();

      await harness.run((value) => {
        refreshPromise = captureDeferredRejection(value.refreshChecks());
      });
      await harness.waitFor((value) => value.isLoadingChecks === true);
      expect(diagnosticsTimeoutHandlers.size).toBe(1);

      for (const handler of diagnosticsTimeoutHandlers) {
        handler();
      }
      diagnosticsTimeoutHandlers.clear();

      await harness.run(async () => {
        return expect(refreshPromise).rejects.toThrow("runtime down");
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);

      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          description: "runtime down",
        }),
      );
      expect(toastMessage).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      void taskStoreDeferred.promise.catch(() => {});
      taskStoreDeferred.reject(new Error("cleanup"));
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
          value.runtimeCheck?.errors[0] === "Timed out after 15000ms" &&
          value.activeTaskStoreCheck?.taskStoreError === "Timed out after 15000ms" &&
          value.runtimeCheckFailureKind === "timeout" &&
          value.taskStoreCheckFailureKind === "timeout" &&
          value.isLoadingChecks === false,
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

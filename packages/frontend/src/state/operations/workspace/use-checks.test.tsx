import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type GitCheck,
  type PathCheck,
  type TaskStoreCheck,
  type HostRuntimeSnapshot,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createHostRuntimeStatusOwner } from "@/state/host-runtime/host-runtime-status-owner";
import { hostRuntimeStatusQueryKeys } from "@/state/queries/host-runtime-status";
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

const makeGitCheck = (overrides: Partial<GitCheck> = {}): GitCheck => ({
  ok: true,
  executablePath: "/bin/git",
  version: "git version 2.45.0",
  error: null,
  ...overrides,
});
const makePathCheck = (overrides: Partial<PathCheck> = {}): PathCheck => ({
  ok: true,
  error: null,
  ...overrides,
});

const makeTaskStoreCheck = (overrides: TaskStoreCheckFixtureOverrides = {}): TaskStoreCheck =>
  createTaskStoreCheckFixture({}, overrides);

const toastError = mock(
  (_message: string, _options?: { description?: string; id?: string; duration?: number }) => {},
);
const toastDismiss = mock((_toastId?: string | number) => {});
const testToastApi: DiagnosticsToastApi = {
  error: (message, options) => toastError(message, options),
  dismiss: (toastId) => toastDismiss(toastId),
};
let pathCheckHandler = async (_force?: boolean): Promise<PathCheck> => makePathCheck();
const pathCheckMock = mock((force?: boolean) => pathCheckHandler(force));
let gitCheckHandler = async (): Promise<GitCheck> => makeGitCheck();
let taskStoreCheckHandler = async (_repoPath: string): Promise<TaskStoreCheck> =>
  makeTaskStoreCheck();
const gitCheckMock = mock(() => gitCheckHandler());
const taskStoreCheckMock = mock((repoPath: string) => taskStoreCheckHandler(repoPath));
const refreshHostRuntimeStatusMock = mock(async () => {});

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
      "pathCheck" | "gitCheck" | "taskStoreCheck" | "toastApi" | "refreshHostRuntimeStatus"
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
  if (activeWorkspace === undefined) throw new Error("Hook args must include activeWorkspace");

  return {
    ...previous,
    ...args,
    activeWorkspace,
    pathCheck: args.pathCheck ?? previous?.pathCheck ?? pathCheckMock,
    gitCheck: args.gitCheck ?? previous?.gitCheck ?? gitCheckMock,
    taskStoreCheck: args.taskStoreCheck ?? previous?.taskStoreCheck ?? taskStoreCheckMock,
    toastApi: args.toastApi ?? previous?.toastApi ?? testToastApi,
    refreshHostRuntimeStatus:
      args.refreshHostRuntimeStatus ??
      previous?.refreshHostRuntimeStatus ??
      refreshHostRuntimeStatusMock,
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
      value.pathCheck.data !== null &&
      value.gitCheck.data !== null &&
      value.taskStoreCheck.data !== null
    );
  });
};

beforeEach(async () => {
  toastError.mockClear();
  toastDismiss.mockClear();
  pathCheckMock.mockClear();
  gitCheckMock.mockClear();
  taskStoreCheckMock.mockClear();
  refreshHostRuntimeStatusMock.mockClear();
  pathCheckHandler = async () => makePathCheck();
  gitCheckHandler = async () => makeGitCheck();
  taskStoreCheckHandler = async (_repoPath: string) => makeTaskStoreCheck();
});

describe("use-checks", () => {
  test("refreshChecks reruns host checks without a workspace", async () => {
    const harness = createHookHarness({
      activeRepo: null,
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.gitCheck.data !== null);
      gitCheckMock.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(refreshHostRuntimeStatusMock).toHaveBeenCalledTimes(1);
      expect(pathCheckMock.mock.calls).toEqual([[false], [true]]);
      expect(gitCheckMock).toHaveBeenCalledTimes(1);
      expect(taskStoreCheckMock).not.toHaveBeenCalled();
      expect(harness.getLatest().checksRepoPath).toBeNull();
      expect(harness.getLatest().isRefreshingChecks).toBe(false);
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("refreshChecks forces PATH resolution after an ordinary read settles", async () => {
    const ordinaryCheck = createDeferred<PathCheck>();
    const pathError = "Failed to resolve PATH: login shell timed out.";
    pathCheckHandler = async (force) => (force ? makePathCheck() : ordinaryCheck.promise);
    const harness = createHookHarness({
      activeRepo: null,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => pathCheckMock.mock.calls.length === 1);
      await harness.run(async (value) => {
        const refresh = value.refreshChecks();
        ordinaryCheck.resolve(makePathCheck({ ok: false, error: pathError }));
        await refresh;
      });

      expect(pathCheckMock.mock.calls).toEqual([[false], [true]]);
      expect(harness.getLatest().pathCheck.data?.ok).toBe(true);
      expect(harness.getLatest().pathCheck.data?.error).toBeNull();
    } finally {
      await harness.unmount();
    }
  }, 5000);

  test("Git refresh waits for PATH but not for runtime status or task storage", async () => {
    const harness = createHookHarness({ activeRepo: "/repo-a" });
    const runtime = createDeferred<void>();
    const store = createDeferred<TaskStoreCheck>();
    const path = createDeferred<PathCheck>();
    let refreshed: Promise<void> | undefined;
    try {
      await waitForInitialChecksToSettle(harness);
      await harness.updateArgs({ refreshHostRuntimeStatus: () => runtime.promise });
      pathCheckHandler = async () => path.promise;
      taskStoreCheckHandler = async () => store.promise;
      gitCheckHandler = async () => makeGitCheck({ executablePath: "/new/bin/git" });
      gitCheckMock.mockClear();
      await harness.run((value) => {
        refreshed = value.refreshChecks();
      });
      expect(gitCheckMock).not.toHaveBeenCalled();
      await harness.run(() => {
        path.resolve(makePathCheck());
      });
      await harness.waitFor((value) => value.gitCheck.data?.executablePath === "/new/bin/git");
      expect(harness.getLatest().isRefreshingChecks).toBe(true);
      expect(harness.getLatest().pathCheck.error).toBeNull();
    } finally {
      path.resolve(makePathCheck());
      runtime.resolve();
      store.resolve(makeTaskStoreCheck());
      await harness.run(async () => {
        await refreshed;
      });
      await harness.unmount();
    }
  });

  test("a runtime-status timeout releases Diagnostics Refresh and leaves PATH and Git observed", async () => {
    const runtimeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const callbacks = new Set<() => void>();
    const runtimeStatus = createDeferred<HostRuntimeSnapshot>();
    const runtimeOwner = createHostRuntimeStatusOwner({
      queryClient: runtimeQueryClient,
      ports: {
        subscribeRuntimeChanges: async () => () => {},
        runtimeStatus: () => runtimeStatus.promise,
      },
      scheduleTask: (callback) => {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
    });
    runtimeOwner.start();
    const harness = createHookHarness({
      activeRepo: null,
      refreshHostRuntimeStatus: runtimeOwner.refresh,
    });
    let refreshed: Promise<void> | undefined;
    try {
      await harness.mount();
      await harness.waitFor(
        (value) => value.pathCheck.data !== null && value.gitCheck.data !== null,
      );
      const gitCalls = gitCheckMock.mock.calls.length;
      await harness.run((value) => {
        refreshed = value.refreshChecks();
      });
      await harness.waitFor(() => gitCheckMock.mock.calls.length > gitCalls);
      expect(harness.getLatest().isRefreshingChecks).toBe(true);
      await harness.run(async () => {
        for (const callback of callbacks) callback();
        await refreshed;
      });
      expect(harness.getLatest().isRefreshingChecks).toBe(false);
      expect(harness.getLatest().pathCheck.data?.ok).toBe(true);
      expect(harness.getLatest().gitCheck.data?.ok).toBe(true);
      expect(harness.getLatest().pathCheck.error).toBeNull();
      expect(harness.getLatest().gitCheck.error).toBeNull();
      expect(
        runtimeQueryClient.getQueryState(hostRuntimeStatusQueryKeys.snapshot)?.error?.message,
      ).toContain("Timed out");
      expect(runtimeOwner.getConnection().isRefreshing).toBe(false);
    } finally {
      runtimeOwner.stop();
      runtimeQueryClient.clear();
      await harness.run(async () => {
        await refreshed;
      });
      await harness.unmount();
    }
  });

  test("a forced Git refresh does not reuse an older pending discovery", async () => {
    const older = createDeferred<GitCheck>();
    let calls = 0;
    gitCheckHandler = async () =>
      ++calls === 1 ? older.promise : makeGitCheck({ executablePath: "/new/bin/git" });
    const harness = createHookHarness({ activeRepo: null });
    let refreshed: Promise<void> | undefined;
    try {
      await harness.mount();
      await harness.waitFor(() => gitCheckMock.mock.calls.length === 1);
      await harness.run((value) => {
        refreshed = value.refreshChecks();
      });
      await harness.waitFor(() => pathCheckMock.mock.calls.length === 2);
      expect(gitCheckMock).toHaveBeenCalledTimes(1);
      await harness.run(async () => {
        older.resolve(makeGitCheck());
        await refreshed;
      });
      expect(gitCheckMock).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().gitCheck.data?.executablePath).toBe("/new/bin/git");
    } finally {
      older.resolve(makeGitCheck());
      await harness.run(async () => {
        await refreshed;
      });
      await harness.unmount();
    }
  });

  test("refreshChecks reports each failed probe in its own state without throwing", async () => {
    const harness = createHookHarness({
      activeRepo: "/repo-a",
    });

    try {
      await waitForInitialChecksToSettle(harness);
      gitCheckHandler = async () => {
        throw new Error("Git read failed");
      };
      await harness.run(async (value) => {
        await value.refreshChecks();
      });
      await harness.waitFor((value) => value.gitCheck.failureKind === "error");

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
    });

    try {
      await waitForInitialChecksToSettle(harness);
      const initial = harness.getLatest();
      expect(initial.pathCheck.error).toBeNull();
      expect(initial.pathCheck.observedAt).not.toBeNull();
      expect(initial.gitCheck.error).toBeNull();
      expect(initial.taskStoreCheck.error).toBeNull();
      expect(initial.gitCheck.observedAt).not.toBeNull();
      expect(initial.taskStoreCheck.observedAt).not.toBeNull();

      pathCheckHandler = async () => {
        throw new Error("PATH read failed");
      };
      gitCheckHandler = async () => {
        throw new Error("Git read failed");
      };
      taskStoreCheckHandler = async () => {
        throw new Error("task store down");
      };
      await harness.run(async (value) => {
        await value.refreshChecks();
      });
      await harness.waitFor(
        (value) =>
          value.pathCheck.error === "PATH read failed" &&
          value.gitCheck.error === "Git read failed" &&
          value.taskStoreCheck.error === "task store down",
      );

      const latest = harness.getLatest();
      expect(latest.pathCheck.failureKind).toBe("error");
      expect(latest.pathCheck.data).toEqual(makePathCheck());
      expect(latest.pathCheck.observedAt).toBe(initial.pathCheck.observedAt);
      expect(latest.gitCheck.failureKind).toBe("error");
      expect(latest.taskStoreCheck.failureKind).toBe("error");
      expect(latest.gitCheck.data).toEqual(makeGitCheck());
      expect(latest.taskStoreCheck.data).toEqual(makeTaskStoreCheck());
      expect(latest.gitCheck.observedAt).toBe(initial.gitCheck.observedAt);
      expect(latest.taskStoreCheck.observedAt).toBe(initial.taskStoreCheck.observedAt);
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
  test("shows Git and task-store toasts for unhealthy successful payloads", async () => {
    let gitCallCount = 0;
    let taskStoreCallCount = 0;
    const gitCheck = mock(async (): Promise<GitCheck> => {
      gitCallCount += 1;
      return gitCallCount === 1
        ? makeGitCheck()
        : makeGitCheck({ ok: false, executablePath: null, version: null, error: "git missing" });
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

    gitCheckHandler = gitCheck;
    taskStoreCheckHandler = taskStoreCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
    });

    try {
      await waitForInitialChecksToSettle(harness);
      toastError.mockClear();

      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(toastError).toHaveBeenCalledWith(
        "Git unavailable",
        expect.objectContaining({
          id: "diagnostics:git",
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
  test("keeps timed out reads unknown with separate errors", async () => {
    const gitDeferred = createDeferred<GitCheck>();
    const pathDeferred = createDeferred<PathCheck>();
    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const scheduleTask = mock<ScheduleTask>((callback, delayMs) => {
      expect([15_000, 30_000]).toContain(delayMs);
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

    gitCheckHandler = mock(async () => gitDeferred.promise);
    pathCheckHandler = mock(async () => pathDeferred.promise);
    taskStoreCheckHandler = mock(async () => taskStoreDeferred.promise);

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      scheduleTask,
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          value.pathCheck.error === "Timed out after 30000ms" &&
          value.gitCheck.error === "Timed out after 15000ms" &&
          value.taskStoreCheck.error === "Timed out after 15000ms" &&
          value.gitCheck.failureKind === "timeout" &&
          value.taskStoreCheck.failureKind === "timeout",
      );

      expect(harness.getLatest().pathCheck.data).toBeNull();
      expect(harness.getLatest().gitCheck.data).toBeNull();
      expect(harness.getLatest().taskStoreCheck.data).toBeNull();
      // A timeout shows in the check state, not as an error toast.
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      pathDeferred.resolve(makePathCheck());
      void gitDeferred.promise.catch(() => {});
      void taskStoreDeferred.promise.catch(() => {});
      gitDeferred.reject(new Error("cleanup"));
      taskStoreDeferred.reject(new Error("cleanup"));
    }
  }, 5000);
});

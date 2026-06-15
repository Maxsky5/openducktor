import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskStoreCheck } from "@openducktor/contracts";
import { createHostClient } from "@openducktor/host-client";
import { CancelledError } from "@tanstack/react-query";
import { act } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createTaskStoreCheckFixture,
  type TaskStoreCheckFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";

const actualHostClientModule = await import("@/lib/host-client");
const actualSonnerModule = await import("sonner");

let subscribedTaskListener: ((payload: unknown) => void) | null = null;
let subscribeTaskEventsImpl:
  | ((listener: (payload: unknown) => void) => Promise<() => void>)
  | null = null;
const toastError = mock((_message: string, _options?: { description?: string }) => "");
const toastLoading = mock((_message: string, _options?: { description?: string }) => "toast-id");
const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
const toastDismiss = mock((_toastId?: string | number) => {});

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

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

const makeTaskStoreCheck = (overrides: TaskStoreCheckFixtureOverrides = {}): TaskStoreCheck =>
  createTaskStoreCheckFixture({}, overrides);

const makeUnavailableTaskStoreCheck = (): TaskStoreCheck =>
  makeTaskStoreCheck({
    taskStoreOk: false,
    taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
    taskStoreError: "SQLite task store database is unavailable",
    repoStoreHealth: {
      category: "database_unavailable",
      status: "blocking",
      isReady: false,
      detail: "SQLite task store database is unavailable",
      databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
    },
  });

const createActiveWorkspace = (
  repoPath: string,
  workspaceId = repoPath.replace(/^\//, "").replaceAll("/", "-"),
): ActiveWorkspace => ({
  workspaceId,
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

type UseAppLifecycleArgs = Parameters<
  Awaited<typeof import("./use-app-lifecycle")>["useAppLifecycle"]
>[0];

type LegacyUseAppLifecycleArgs = Omit<UseAppLifecycleArgs, "activeWorkspace"> & {
  activeWorkspace?: ActiveWorkspace | null;
  activeRepo?: string | null;
  setEvents?: unknown;
  setRunCompletionSignal?: unknown;
};

const normalizeHookArgs = ({
  activeWorkspace,
  activeRepo,
  ...rest
}: LegacyUseAppLifecycleArgs): UseAppLifecycleArgs => ({
  ...rest,
  activeWorkspace: activeWorkspace ?? (activeRepo ? createActiveWorkspace(activeRepo) : null),
});
beforeEach(() => {
  subscribeTaskEventsImpl = async (listener: (payload: unknown) => void) => {
    subscribedTaskListener = listener;
    return () => {
      subscribedTaskListener = null;
    };
  };
  mock.module("@/lib/host-client", () => ({
    createHostBridge: () => ({
      client: createHostClient(async () => {
        throw new Error("Host runtime not available. Run inside a supported shell.");
      }),
      subscribeTaskEvents: async (listener: (payload: unknown) => void) => {
        if (!subscribeTaskEventsImpl) {
          throw new Error("Expected subscribeTaskEventsImpl to be configured");
        }
        return subscribeTaskEventsImpl(listener);
      },
    }),
    createHostClient: () =>
      createHostClient(async () => {
        throw new Error("Host runtime not available. Run inside a supported shell.");
      }),
    hostBridge: {
      client: createHostClient(async () => {
        throw new Error("Host runtime not available. Run inside a supported shell.");
      }),
      subscribeTaskEvents: async (listener: (payload: unknown) => void) => {
        if (!subscribeTaskEventsImpl) {
          throw new Error("Expected subscribeTaskEventsImpl to be configured");
        }
        return subscribeTaskEventsImpl(listener);
      },
    },
    hostClient: createHostClient(async () => {
      throw new Error("Host runtime not available. Run inside a supported shell.");
    }),
    subscribeTaskEvents: async (listener: (payload: unknown) => void) => {
      if (!subscribeTaskEventsImpl) {
        throw new Error("Expected subscribeTaskEventsImpl to be configured");
      }
      return subscribeTaskEventsImpl(listener);
    },
  }));
  mock.module("sonner", () => ({
    toast: {
      error: toastError,
      loading: toastLoading,
      success: toastSuccess,
      dismiss: toastDismiss,
    },
  }));
  subscribedTaskListener = null;
  toastError.mockClear();
  toastLoading.mockClear();
  toastSuccess.mockClear();
  toastDismiss.mockClear();
});

afterEach(() => {
  subscribeTaskEventsImpl = null;
});

afterEach(async () => {
  await restoreMockedModules([
    ["@/lib/host-client", async () => actualHostClientModule],
    ["sonner", async () => actualSonnerModule],
  ]);
});

describe("useAppLifecycle", () => {
  test("refreshes active repo task data when an external task event arrives", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(() => {
        subscribedTaskListener?.({
          eventId: "event-1",
          kind: "external_task_created",
          repoPath: "/repo",
          taskId: "task-1",
          emittedAt: "2026-04-10T13:00:00.000Z",
        });
      });

      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1", {
        source: "external-sync",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("cleans up a task-event subscription that resolves after unmount", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const deferred = createDeferred<() => void>();
    let cleanupCalls = 0;
    subscribeTaskEventsImpl = async (listener: (payload: unknown) => void) => {
      subscribedTaskListener = listener;
      return deferred.promise;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData: mock(async () => {}),
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });

    await harness.mount();
    await harness.unmount();

    deferred.resolve(() => {
      cleanupCalls += 1;
      subscribedTaskListener = null;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(cleanupCalls).toBe(1);
    expect(subscribedTaskListener).toBeNull();
  });

  test("ignores external task events for a different repo", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo-a",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo-a/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(() => {
        subscribedTaskListener?.({
          eventId: "event-1",
          kind: "external_task_created",
          repoPath: "/repo-b",
          taskId: "task-1",
          emittedAt: "2026-04-10T13:00:00.000Z",
        });
      });

      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("deduplicates replayed external task events by event id", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(() => {
        subscribedTaskListener?.({
          eventId: "event-1",
          kind: "external_task_created",
          repoPath: "/repo",
          taskId: "task-1",
          emittedAt: "2026-04-10T13:00:00.000Z",
        });
        subscribedTaskListener?.({
          eventId: "event-1",
          kind: "external_task_created",
          repoPath: "/repo",
          taskId: "task-1",
          emittedAt: "2026-04-10T13:00:00.000Z",
        });
      });

      expect(refreshTaskData).toHaveBeenCalledTimes(1);
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1", {
        source: "external-sync",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces task refresh failures triggered by external task events", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, taskIdOrIds?: string | string[]) => {
      if (taskIdOrIds === "task-1") {
        throw new Error("sync failed");
      }
    });

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(async () => {
        subscribedTaskListener?.({
          eventId: "event-1",
          kind: "external_task_created",
          repoPath: "/repo",
          taskId: "task-1",
          emittedAt: "2026-04-10T13:00:00.000Z",
        });
        await Promise.resolve();
      });

      expect(toastError).toHaveBeenCalledWith("Failed to sync external task changes", {
        description: "sync failed",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("resyncs the active repo when the browser-live task stream reconnects", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(async () => {
        subscribedTaskListener?.({
          __openducktorBrowserLive: true,
          kind: "reconnected",
        });
        await Promise.resolve();
      });

      expect(refreshTaskData).toHaveBeenCalledWith("/repo", undefined, {
        source: "external-sync",
      });
      expect(toastError).not.toHaveBeenCalledWith("Task sync stream degraded", expect.anything());
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces browser-live task stream warnings and triggers a resync", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(async () => {
        subscribedTaskListener?.({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Task stream skipped 2 events; reconnect will replay buffered events.",
        });
        await Promise.resolve();
      });

      expect(toastError).toHaveBeenCalledWith("Task sync stream degraded", {
        description: "Task stream skipped 2 events; reconnect will replay buffered events.",
      });
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", undefined, {
        source: "external-sync",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("loads repo task and diagnostics checks when the active repo changes", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    let currentArgs!: HookArgs;

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    type LifecycleHarness = {
      mount: () => Promise<void>;
      update: (nextProps: { args: HookArgs }) => Promise<void>;
      run: (fn: (state: null) => void | Promise<void>) => Promise<void>;
      unmount: () => Promise<void>;
    };

    let mountedHarness: LifecycleHarness | null = null;
    const mount = async (args: HookArgs): Promise<void> => {
      currentArgs = args;
      mountedHarness = createSharedHookHarness(Harness, { args });
      await mountedHarness.mount();
    };
    const update = async (args: HookArgs): Promise<void> => {
      currentArgs = args;
      if (!mountedHarness) {
        throw new Error("Expected lifecycle harness to be mounted");
      }
      await mountedHarness.update({ args });
    };
    const requireHarness = (): LifecycleHarness => {
      if (!mountedHarness) {
        throw new Error("Expected lifecycle harness to be mounted");
      }
      return mountedHarness;
    };
    const disposeHarness = async (): Promise<void> => {
      if (mountedHarness) {
        await mountedHarness.unmount();
      }
    };

    const taskLoadDeferred = createDeferred<void>();
    const runtimeRepoCheckDeferred = createDeferred<unknown>();
    const branchesDeferred = createDeferred<void>();

    let runtimeCheckCallCount = 0;
    const refreshRuntimeCheck = mock(() => {
      runtimeCheckCallCount += 1;
      return runtimeCheckCallCount === 1
        ? Promise.resolve({ runtimeOk: true })
        : runtimeRepoCheckDeferred.promise;
    });

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck,
      refreshTaskStoreCheckForRepo: mock(async () =>
        makeTaskStoreCheck({
          taskStoreOk: true,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: null,
        }),
      ),
      refreshTaskData: mock(async () => taskLoadDeferred.promise),
      clearBranchData: mock(() => {}),
    };

    try {
      await mount(baseArgs);

      await update({
        ...currentArgs,
        activeRepo: "/repo",
      });

      expect(baseArgs.refreshTaskData).toHaveBeenCalledWith("/repo", undefined, {
        forceFreshTaskList: false,
      });
      expect(baseArgs.refreshBranches).toHaveBeenCalledWith(false);

      const activeHarness = requireHarness();

      await activeHarness.run(async () => {
        taskLoadDeferred.resolve();
      });

      expect(baseArgs.refreshTaskData).toHaveBeenCalledTimes(1);

      await activeHarness.run(async () => {
        runtimeRepoCheckDeferred.resolve({ runtimeOk: true });
        branchesDeferred.resolve();
      });

      expect(refreshRuntimeCheck).toHaveBeenCalledTimes(2);
    } finally {
      taskLoadDeferred.resolve();
      runtimeRepoCheckDeferred.resolve({ runtimeOk: true });
      branchesDeferred.resolve();
      await disposeHarness();
    }
  });

  test("refreshes the repo once for batched task update events", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(() => {
        subscribedTaskListener?.({
          eventId: "event-2",
          kind: "tasks_updated",
          repoPath: "/repo",
          taskIds: ["task-1", "task-2"],
          emittedAt: "2026-04-10T13:10:00.000Z",
        });
      });

      expect(refreshTaskData).toHaveBeenCalledTimes(1);
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", ["task-1", "task-2"], {
        source: "external-sync",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not resync when a replayed batched task update event is duplicated", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, _taskIdOrIds?: string | string[]) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(() => {
        subscribedTaskListener?.({
          eventId: "event-2",
          kind: "tasks_updated",
          repoPath: "/repo",
          taskIds: ["task-1", "task-2"],
          emittedAt: "2026-04-10T13:10:00.000Z",
        });
        subscribedTaskListener?.({
          eventId: "event-2",
          kind: "tasks_updated",
          repoPath: "/repo",
          taskIds: ["task-1", "task-2"],
          emittedAt: "2026-04-10T13:10:00.000Z",
        });
      });

      expect(refreshTaskData).toHaveBeenCalledTimes(1);
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", ["task-1", "task-2"], {
        source: "external-sync",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces batched task update refresh failures", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string, taskIdOrIds?: string | string[]) => {
      if (Array.isArray(taskIdOrIds) && taskIdOrIds.includes("task-1")) {
        throw new Error("sync failed");
      }
    });

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(async () => {
        subscribedTaskListener?.({
          eventId: "event-2",
          kind: "tasks_updated",
          repoPath: "/repo",
          taskIds: ["task-1", "task-2"],
          emittedAt: "2026-04-10T13:10:00.000Z",
        });
        await Promise.resolve();
      });

      expect(toastError).toHaveBeenCalledWith("Failed to sync task updates", {
        description: "sync failed",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("deduplicates repeated batched task update refresh failures", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async () => {
      throw new Error("sync failed");
    });

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshTaskStoreCheckForRepo: mock(async () =>
          makeTaskStoreCheck({
            taskStoreOk: true,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: null,
          }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(async () => {
        subscribedTaskListener?.({
          eventId: "event-3",
          kind: "tasks_updated",
          repoPath: "/repo",
          taskIds: ["task-1"],
          emittedAt: "2026-04-10T13:10:00.000Z",
        });
        subscribedTaskListener?.({
          eventId: "event-4",
          kind: "tasks_updated",
          repoPath: "/repo",
          taskIds: ["task-1"],
          emittedAt: "2026-04-10T13:10:01.000Z",
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        toastError.mock.calls.filter(([title]) => title === "Failed to sync task updates"),
      ).toHaveLength(1);
    } finally {
      await harness.unmount();
    }
  });

  test("resets external task sync failure dedupe when the active repo changes", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async () => {
      throw new Error("sync failed");
    });

    const baseArgs = {
      activeRepo: "/repo-a",
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => {}),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () =>
        makeTaskStoreCheck({
          taskStoreOk: true,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: null,
        }),
      ),
      refreshTaskData,
      clearBranchData: mock(() => {}),
    } satisfies HookArgs;

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, { args: baseArgs });
    await harness.mount();
    try {
      if (!subscribedTaskListener) {
        throw new Error("Expected task event listener to be registered");
      }

      await harness.run(async () => {
        subscribedTaskListener?.({
          eventId: "event-5",
          kind: "tasks_updated",
          repoPath: "/repo-a",
          taskIds: ["task-1"],
          emittedAt: "2026-04-10T13:10:00.000Z",
        });
        await Promise.resolve();
      });
      expect(
        toastError.mock.calls.filter(([title]) => title === "Failed to sync task updates"),
      ).toHaveLength(1);

      await harness.update({ args: { ...baseArgs, activeRepo: "/repo-b" } });
      await harness.update({ args: baseArgs });

      await harness.run(async () => {
        subscribedTaskListener?.({
          eventId: "event-6",
          kind: "tasks_updated",
          repoPath: "/repo-a",
          taskIds: ["task-1"],
          emittedAt: "2026-04-10T13:10:01.000Z",
        });
        await Promise.resolve();
      });

      expect(
        toastError.mock.calls.filter(([title]) => title === "Failed to sync task updates"),
      ).toHaveLength(2);
    } finally {
      await harness.unmount();
    }
  });

  test("does not show repository tasks unavailable when startup task load is cancelled", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const baseArgs = {
      activeRepo: "/repo",
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => {}),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () =>
        makeTaskStoreCheck({
          taskStoreOk: true,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: null,
        }),
      ),
      refreshTaskData: mock(async () => {
        throw new CancelledError();
      }),
      clearBranchData: mock(() => {}),
    } satisfies HookArgs;

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await act(async () => {
        await Promise.resolve();
      });

      expect(toastError).not.toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "CancelledError",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not block repo diagnostics load on branch refresh completion", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskLoadDeferred = createDeferred<void>();
    const runtimeRepoCheckDeferred = createDeferred<unknown>();
    const branchesDeferred = createDeferred<void>();

    let runtimeCheckCallCount = 0;
    const refreshRuntimeCheck = mock(() => {
      runtimeCheckCallCount += 1;
      return runtimeCheckCallCount === 1
        ? Promise.resolve({ runtimeOk: true })
        : runtimeRepoCheckDeferred.promise;
    });

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck,
      refreshTaskStoreCheckForRepo: mock(async () =>
        makeTaskStoreCheck({
          taskStoreOk: true,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: null,
        }),
      ),
      refreshTaskData: mock(async () => taskLoadDeferred.promise),
      clearBranchData: mock(() => {}),
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await harness.run(async () => {
        taskLoadDeferred.resolve();
        runtimeRepoCheckDeferred.resolve({ runtimeOk: true });
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(baseArgs.refreshTaskData).toHaveBeenCalledWith("/repo", undefined, {
        forceFreshTaskList: false,
      });
      expect(refreshRuntimeCheck).toHaveBeenCalledTimes(2);
      expect(baseArgs.refreshBranches).toHaveBeenCalledWith(false);
    } finally {
      taskLoadDeferred.resolve();
      runtimeRepoCheckDeferred.resolve({ runtimeOk: true });
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("suppresses late repo-load toasts after the repository is deselected", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskDeferred = createDeferred<void>();
    const runtimeDeferred = createDeferred<unknown>();
    const branchesDeferred = createDeferred<void>();

    let runtimeCheckCallCount = 0;
    const refreshRuntimeCheck = mock(() => {
      runtimeCheckCallCount += 1;
      return runtimeCheckCallCount === 1
        ? Promise.resolve({ runtimeOk: true })
        : runtimeDeferred.promise;
    });

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck,
      refreshTaskStoreCheckForRepo: mock(async () =>
        makeTaskStoreCheck({
          taskStoreOk: true,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: null,
        }),
      ),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: null,
        },
      });

      await harness.run(async () => {
        taskDeferred.reject(new Error("tasks failed after deselect"));
        runtimeDeferred.reject(new Error("runtime failed after deselect"));
        branchesDeferred.reject(new Error("branches failed after deselect"));
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(toastError).not.toHaveBeenCalledWith(
        "Repository tasks unavailable",
        expect.anything(),
      );
      expect(toastError).not.toHaveBeenCalledWith("Runtime checks unavailable", expect.anything());
      expect(toastError).not.toHaveBeenCalledWith(
        "Repository branches unavailable",
        expect.anything(),
      );
    } finally {
      taskDeferred.resolve();
      runtimeDeferred.resolve({ runtimeOk: true });
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("shows task-store preparation toasts when repository initialization is slow", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () => taskStoreDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });

      expect(toastLoading).toHaveBeenCalledWith("Preparing task store", {
        description: "OpenDucktor is opening the SQLite task store for this repository.",
      });

      await harness.run(async () => {
        taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).toHaveBeenCalledWith("task store ready", {
        description: "The task store is ready for this repository.",
      });
    } finally {
      taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("refreshes task-store diagnostics after successful task initialization", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const branchesDeferred = createDeferred<void>();
    const refreshTaskStoreCheckForRepo = mock(
      async (_repoPath: string, force = false): Promise<TaskStoreCheck> =>
        force
          ? makeTaskStoreCheck({ taskStorePath: null })
          : makeTaskStoreCheck({
              taskStoreOk: false,
              taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              taskStoreError: "SQLite task store database is unavailable",
              repoStoreHealth: {
                category: "database_unavailable",
                status: "blocking",
                isReady: false,
                detail: "SQLite task store database is unavailable",
                databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              },
            }),
    );

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo,
      refreshTaskData: mock(async () => {}),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await harness.run(async () => {
        branchesDeferred.resolve();
      });

      expect(refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(1, "/repo", false);
      expect(refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);
    } finally {
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("refreshes task-store diagnostics even when startup task loading is cancelled", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const branchesDeferred = createDeferred<void>();
    const refreshTaskStoreCheckForRepo = mock(
      async (_repoPath: string, force = false): Promise<TaskStoreCheck> =>
        force
          ? makeTaskStoreCheck({ taskStorePath: null })
          : makeTaskStoreCheck({
              taskStoreOk: false,
              taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              taskStoreError: "SQLite task store database is unavailable",
              repoStoreHealth: {
                category: "database_unavailable",
                status: "blocking",
                isReady: false,
                detail: "SQLite task store database is unavailable",
                databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              },
            }),
    );

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo,
      refreshTaskData: mock(async () => {
        throw new CancelledError();
      }),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    } satisfies HookArgs;

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await harness.run(async () => {
        branchesDeferred.resolve();
      });

      expect(refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(1, "/repo", false);
      expect(refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);
      expect(toastError).not.toHaveBeenCalledWith(
        "Repository tasks unavailable",
        expect.anything(),
      );
    } finally {
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("does not force a second task-store refresh when the first check is already ready", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();
    const refreshTaskStoreCheckForRepo = mock(
      async (): Promise<TaskStoreCheck> => makeTaskStoreCheck({ taskStorePath: null }),
    );

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo,
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await harness.run(async () => {
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });

      expect(refreshTaskStoreCheckForRepo).toHaveBeenCalledTimes(1);
      expect(refreshTaskStoreCheckForRepo).toHaveBeenCalledWith("/repo", false);
    } finally {
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("does not show task-store preparation toast when task loading is slow but the task store is already ready", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () =>
        makeTaskStoreCheck({ taskStoreOk: true, taskStorePath: null, taskStoreError: null }),
      ),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });

      expect(toastLoading).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();

      await harness.run(async () => {
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });
    } finally {
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("keeps task-store preparation toast active while a missing attachment is initialized by task loading", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();
    const refreshTaskStoreCheckForRepo = mock(
      async (_repoPath: string, force = false): Promise<TaskStoreCheck> =>
        force
          ? makeTaskStoreCheck({
              taskStoreOk: true,
              taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              taskStoreError: null,
            })
          : makeUnavailableTaskStoreCheck(),
    );

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo,
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });

      expect(toastLoading).toHaveBeenCalledWith("Preparing task store", {
        description: "OpenDucktor is opening the SQLite task store for this repository.",
      });
      expect(toastDismiss).not.toHaveBeenCalled();

      await harness.run(async () => {
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });

      expect(refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(1, "/repo", false);
      expect(refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);
      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).toHaveBeenCalledWith("task store ready", {
        description: "The task store is ready for this repository.",
      });
    } finally {
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("clears pending task-store preparation timer when initialization fails before the toast delay", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () => taskStoreDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 15,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await harness.run(async () => {
        taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
        taskDeferred.reject(new Error("init failed"));
        branchesDeferred.resolve();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(toastLoading).not.toHaveBeenCalled();
      expect(toastDismiss).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "init failed",
      });
    } finally {
      taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("dismisses the task-store preparation toast when task loading fails after it is shown", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () => taskStoreDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });

      expect(toastLoading).toHaveBeenCalledWith("Preparing task store", {
        description: "OpenDucktor is opening the SQLite task store for this repository.",
      });

      await harness.run(async () => {
        taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
        taskDeferred.reject(new Error("store failed"));
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "store failed",
      });
    } finally {
      taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("keeps a shown task-store preparation toast until task loading finishes after a blocking first check", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () => taskStoreDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });

      expect(toastLoading).toHaveBeenCalledWith("Preparing task store", {
        description: "OpenDucktor is opening the SQLite task store for this repository.",
      });

      await harness.run(async () => {
        taskStoreDeferred.resolve(makeUnavailableTaskStoreCheck());
      });

      expect(toastDismiss).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();

      await harness.run(async () => {
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
    } finally {
      taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("preserves the thrown repo-load error even when repo-store health is blocking", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskStoreDeferred = createDeferred<TaskStoreCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshTaskStoreCheckForRepo: mock(async () => taskStoreDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      taskStorePreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };

    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo",
        },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });

      await harness.run(async () => {
        taskStoreDeferred.resolve(
          makeTaskStoreCheck({
            taskStoreOk: false,
            taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            taskStoreError: "SQLite task store database is unavailable",
            repoStoreHealth: {
              category: "database_unavailable",
              status: "blocking",
              isReady: false,
              detail: "SQLite task store database is unavailable",
              databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
            },
          }),
        );
        taskDeferred.reject(new Error("gh auth expired"));
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "gh auth expired",
      });
    } finally {
      taskStoreDeferred.resolve(makeTaskStoreCheck({ taskStorePath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });
});

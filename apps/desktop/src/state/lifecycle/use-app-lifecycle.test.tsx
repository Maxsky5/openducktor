import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { BeadsCheck } from "@openducktor/contracts";
import { act } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  type BeadsCheckFixtureOverrides,
  createBeadsCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";

let subscribedRunListener: ((payload: unknown) => void) | null = null;
let subscribedTaskListener: ((payload: unknown) => void) | null = null;
let subscribeRunEventsImpl: ((listener: (payload: unknown) => void) => Promise<() => void>) | null =
  null;
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

const makeBeadsCheck = (overrides: BeadsCheckFixtureOverrides = {}): BeadsCheck =>
  createBeadsCheckFixture({}, overrides);

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
  subscribeRunEventsImpl = async (listener: (payload: unknown) => void) => {
    subscribedRunListener = listener;
    return () => {
      subscribedRunListener = null;
    };
  };
  subscribeTaskEventsImpl = async (listener: (payload: unknown) => void) => {
    subscribedTaskListener = listener;
    return () => {
      subscribedTaskListener = null;
    };
  };
  mock.module("@/lib/host-client", () => ({
    createHostBridge: () => ({
      client: createTauriHostClient(async () => {
        throw new Error("Tauri runtime not available. Run inside the desktop shell.");
      }),
      subscribeRunEvents: async (listener: (payload: unknown) => void) => {
        if (!subscribeRunEventsImpl) {
          throw new Error("Expected subscribeRunEventsImpl to be configured");
        }
        return subscribeRunEventsImpl(listener);
      },
      subscribeTaskEvents: async (listener: (payload: unknown) => void) => {
        if (!subscribeTaskEventsImpl) {
          throw new Error("Expected subscribeTaskEventsImpl to be configured");
        }
        return subscribeTaskEventsImpl(listener);
      },
    }),
    createHostClient: () =>
      createTauriHostClient(async () => {
        throw new Error("Tauri runtime not available. Run inside the desktop shell.");
      }),
    hostBridge: {
      client: createTauriHostClient(async () => {
        throw new Error("Tauri runtime not available. Run inside the desktop shell.");
      }),
      subscribeRunEvents: async (listener: (payload: unknown) => void) => {
        if (!subscribeRunEventsImpl) {
          throw new Error("Expected subscribeRunEventsImpl to be configured");
        }
        return subscribeRunEventsImpl(listener);
      },
      subscribeTaskEvents: async (listener: (payload: unknown) => void) => {
        if (!subscribeTaskEventsImpl) {
          throw new Error("Expected subscribeTaskEventsImpl to be configured");
        }
        return subscribeTaskEventsImpl(listener);
      },
    },
    hostClient: createTauriHostClient(async () => {
      throw new Error("Tauri runtime not available. Run inside the desktop shell.");
    }),
    subscribeRunEvents: async (listener: (payload: unknown) => void) => {
      if (!subscribeRunEventsImpl) {
        throw new Error("Expected subscribeRunEventsImpl to be configured");
      }
      return subscribeRunEventsImpl(listener);
    },
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
  subscribedRunListener = null;
  subscribedTaskListener = null;
  toastError.mockClear();
  toastLoading.mockClear();
  toastSuccess.mockClear();
  toastDismiss.mockClear();
});

afterEach(() => {
  subscribeRunEventsImpl = null;
  subscribeTaskEventsImpl = null;
});

afterEach(async () => {
  await restoreMockedModules([
    ["@/lib/host-client", () => import("@/lib/host-client")],
    ["sonner", () => import("sonner")],
  ]);
});

describe("useAppLifecycle", () => {
  test("refreshes active repo task data when a run completion event arrives", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const refreshTaskData = mock(async (_repoPath: string) => {});
    const setRunCompletionSignal = mock((_runId: string, _eventType) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(normalizeHookArgs(args));
      return null;
    };
    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
        setEvents: mock((_updater) => {}),
        setRunCompletionSignal,
        refreshWorkspaces: mock(async () => {}),
        refreshBranches: mock(async () => {}),
        refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
        ),
        refreshTaskData,
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });
    await harness.mount();
    try {
      refreshTaskData.mockClear();
      if (!subscribedRunListener) {
        throw new Error("Expected run event listener to be registered");
      }

      await harness.run(() => {
        subscribedRunListener?.({
          type: "run_finished",
          runId: "run-1",
          message: "done",
          timestamp: "2026-03-15T10:00:00.000Z",
          success: true,
        });
      });

      expect(setRunCompletionSignal).toHaveBeenCalledWith("run-1", "run_finished");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo");
    } finally {
      await harness.unmount();
    }
  });

  test("cleans up a run-event subscription that resolves after unmount", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const deferred = createDeferred<() => void>();
    let cleanupCalls = 0;
    subscribeRunEventsImpl = async (listener: (payload: unknown) => void) => {
      subscribedRunListener = listener;
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
        ),
        refreshTaskData: mock(async () => {}),
        clearBranchData: mock(() => {}),
      } satisfies HookArgs,
    });

    await harness.mount();
    await harness.unmount();

    deferred.resolve(() => {
      cleanupCalls += 1;
      subscribedRunListener = null;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(cleanupCalls).toBe(1);
    expect(subscribedRunListener).toBeNull();
  });

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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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

      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo-a/.beads", beadsError: null }),
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
        description: "Task store unavailable. sync failed",
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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

      expect(refreshTaskData).toHaveBeenCalledWith("/repo");
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
      expect(refreshTaskData).toHaveBeenCalledWith("/repo");
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
      refreshBeadsCheckForRepo: mock(async () =>
        makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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

      expect(baseArgs.refreshTaskData).toHaveBeenCalledWith("/repo");
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", ["task-1", "task-2"]);
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
        refreshBeadsCheckForRepo: mock(async () =>
          makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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
        description: "Task store unavailable. sync failed",
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
      refreshBeadsCheckForRepo: mock(async () =>
        makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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

      expect(baseArgs.refreshTaskData).toHaveBeenCalledWith("/repo");
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
      refreshBeadsCheckForRepo: mock(async () =>
        makeBeadsCheck({ beadsOk: true, beadsPath: "/repo/.beads", beadsError: null }),
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

  test("shows Beads preparation toasts when repository initialization is slow", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const beadsDeferred = createDeferred<BeadsCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo: mock(async () => beadsDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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

      expect(toastLoading).toHaveBeenCalledWith("Preparing Beads database", {
        description: "OpenDucktor is initializing the Beads task store for this repository.",
      });

      await harness.run(async () => {
        beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).toHaveBeenCalledWith("Beads database ready", {
        description: "The task store is ready for this repository.",
      });
    } finally {
      beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("refreshes Beads diagnostics after successful task initialization", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const branchesDeferred = createDeferred<void>();
    const refreshBeadsCheckForRepo = mock(
      async (_repoPath: string, force = false): Promise<BeadsCheck> =>
        force
          ? makeBeadsCheck({ beadsPath: null })
          : makeBeadsCheck({
              beadsOk: false,
              beadsPath: "/repo/.beads",
              beadsError:
                "error on line 1 for query show databases: dial tcp 127.0.0.1:38240: connect: connection refused",
              repoStoreHealth: {
                category: "shared_server_unavailable",
                status: "blocking",
                isReady: false,
                detail:
                  "error on line 1 for query show databases: dial tcp 127.0.0.1:38240: connect: connection refused",
                attachment: {
                  path: "/repo/.beads",
                  databaseName: "repo_db",
                },
                sharedServer: {
                  host: "127.0.0.1",
                  port: 38240,
                  ownershipState: "unavailable",
                },
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
      refreshBeadsCheckForRepo,
      refreshTaskData: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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

      expect(refreshBeadsCheckForRepo).toHaveBeenNthCalledWith(1, "/repo", false);
      expect(refreshBeadsCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);
    } finally {
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("does not force a second Beads refresh when the first check is already ready", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();
    const refreshBeadsCheckForRepo = mock(
      async (): Promise<BeadsCheck> => makeBeadsCheck({ beadsPath: null }),
    );

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo,
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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

      expect(refreshBeadsCheckForRepo).toHaveBeenCalledTimes(1);
      expect(refreshBeadsCheckForRepo).toHaveBeenCalledWith("/repo", false);
    } finally {
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("does not show Beads preparation toast when task loading is slow but Beads is already ready", async () => {
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
      refreshBeadsCheckForRepo: mock(async () =>
        makeBeadsCheck({ beadsOk: true, beadsPath: null, beadsError: null }),
      ),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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

  test("clears pending Beads preparation timer when initialization fails before the toast delay", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const beadsDeferred = createDeferred<BeadsCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo: mock(async () => beadsDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 15,
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
        beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
        taskDeferred.reject(new Error("init failed"));
        branchesDeferred.resolve();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(toastLoading).not.toHaveBeenCalled();
      expect(toastDismiss).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "Task store unavailable. init failed",
      });
    } finally {
      beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("dismisses the Beads preparation toast when task loading fails after it is shown", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const beadsDeferred = createDeferred<BeadsCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo: mock(async () => beadsDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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

      expect(toastLoading).toHaveBeenCalledWith("Preparing Beads database", {
        description: "OpenDucktor is initializing the Beads task store for this repository.",
      });

      await harness.run(async () => {
        beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
        taskDeferred.reject(new Error("store failed"));
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "Task store unavailable. store failed",
      });
    } finally {
      beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("dismisses a shown Beads preparation toast as soon as the first check leaves initializing", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const beadsDeferred = createDeferred<BeadsCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo: mock(async () => beadsDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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

      expect(toastLoading).toHaveBeenCalledWith("Preparing Beads database", {
        description: "OpenDucktor is initializing the Beads task store for this repository.",
      });

      await harness.run(async () => {
        beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).not.toHaveBeenCalled();

      await harness.run(async () => {
        taskDeferred.resolve();
        branchesDeferred.resolve();
      });
    } finally {
      beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });

  test("preserves the thrown repo-load error even when repo-store health is blocking", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = LegacyUseAppLifecycleArgs;

    const beadsDeferred = createDeferred<BeadsCheck>();
    const taskDeferred = createDeferred<void>();
    const branchesDeferred = createDeferred<void>();

    const baseArgs: HookArgs = {
      activeRepo: null,
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => branchesDeferred.promise),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo: mock(async () => beadsDeferred.promise),
      refreshTaskData: mock(async () => taskDeferred.promise),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
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
        beadsDeferred.resolve(
          makeBeadsCheck({
            beadsOk: false,
            beadsPath: "/repo/.beads",
            beadsError: "Shared Dolt database repo_db is missing and restore is required",
            repoStoreHealth: {
              category: "missing_shared_database",
              status: "restore_needed",
              isReady: false,
              detail: "Shared Dolt database repo_db is missing and restore is required",
              attachment: {
                path: "/repo/.beads",
                databaseName: "repo_db",
              },
            },
          }),
        );
        taskDeferred.reject(new Error("gh auth expired"));
        branchesDeferred.resolve();
      });

      expect(toastDismiss).toHaveBeenCalledWith("toast-id");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Repository tasks unavailable", {
        description: "Task store unavailable. gh auth expired",
      });
    } finally {
      beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { BeadsCheck } from "@openducktor/contracts";
import { act } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createBeadsCheckFixture,
  type BeadsCheckFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";

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

const createIntervalController = () => {
  let nextIntervalId = 1;
  const callbacks = new Map<number, () => void>();
  const originalSetInterval = globalThis.setInterval.bind(globalThis);
  const originalClearInterval = globalThis.clearInterval.bind(globalThis);

  globalThis.setInterval = ((handler: TimerHandler) => {
    if (typeof handler !== "function") {
      throw new Error("Expected interval handler to be a function in lifecycle tests");
    }

    const intervalId = nextIntervalId;
    nextIntervalId += 1;
    callbacks.set(intervalId, handler as () => void);
    return intervalId as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;

  globalThis.clearInterval = ((intervalId: ReturnType<typeof setInterval>) => {
    callbacks.delete(intervalId as unknown as number);
  }) as unknown as typeof clearInterval;

  return {
    tick(): void {
      for (const callback of [...callbacks.values()]) {
        callback();
      }
    },
    restore(): void {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
};

type WindowEventTargetOverride = typeof globalThis & {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  dispatchEvent: (event: Event) => boolean;
};

const createVisibilityStateController = () => {
  let visibilityState: DocumentVisibilityState = "visible";
  const windowTarget = new EventTarget();
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const originalDocumentDispatchEventDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "dispatchEvent",
  );
  const originalAddEventListener = globalThis.addEventListener.bind(globalThis);
  const originalRemoveEventListener = globalThis.removeEventListener.bind(globalThis);
  const originalDispatchEvent = globalThis.dispatchEvent.bind(globalThis);

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });

  Object.defineProperty(document, "dispatchEvent", {
    configurable: true,
    writable: true,
    value: EventTarget.prototype.dispatchEvent.bind(document),
  });
  (globalThis as WindowEventTargetOverride).addEventListener =
    windowTarget.addEventListener.bind(windowTarget);
  (globalThis as WindowEventTargetOverride).removeEventListener =
    windowTarget.removeEventListener.bind(windowTarget);
  (globalThis as WindowEventTargetOverride).dispatchEvent =
    windowTarget.dispatchEvent.bind(windowTarget);

  return {
    set(value: DocumentVisibilityState) {
      visibilityState = value;
    },
    restore() {
      if (originalVisibilityState) {
        Object.defineProperty(document, "visibilityState", originalVisibilityState);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
      if (originalDocumentDispatchEventDescriptor) {
        Object.defineProperty(document, "dispatchEvent", originalDocumentDispatchEventDescriptor);
      } else {
        Reflect.deleteProperty(document, "dispatchEvent");
      }
      (globalThis as WindowEventTargetOverride).addEventListener = originalAddEventListener;
      (globalThis as WindowEventTargetOverride).removeEventListener = originalRemoveEventListener;
      (globalThis as WindowEventTargetOverride).dispatchEvent = originalDispatchEvent;
    },
  };
};

let visibilityStateController: ReturnType<typeof createVisibilityStateController>;

beforeEach(() => {
  visibilityStateController = createVisibilityStateController();
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
  visibilityStateController.restore();
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string) => {});
    const setRunCompletionSignal = mock((_runId: string, _eventType) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const deferred = createDeferred<() => void>();
    let cleanupCalls = 0;
    subscribeRunEventsImpl = async (listener: (payload: unknown) => void) => {
      subscribedRunListener = listener;
      return deferred.promise;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string, _taskId?: string) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const deferred = createDeferred<() => void>();
    let cleanupCalls = 0;
    subscribeTaskEventsImpl = async (listener: (payload: unknown) => void) => {
      subscribedTaskListener = listener;
      return deferred.promise;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string, _taskId?: string) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string, _taskId?: string) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string, taskId?: string) => {
      if (taskId === "task-1") {
        throw new Error("sync failed");
      }
    });

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string, _taskId?: string) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string, _taskId?: string) => {});

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        refreshTasksWithOptions: mock(async () => {}),
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    let currentArgs!: HookArgs;

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
      refreshTasksWithOptions: mock(async () => {}),
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

  test("runs periodic PR sync only while visible and restarts the cadence on visibility changes", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTasksWithOptions = mock(async () => {});
    const baseArgs: HookArgs = {
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
      refreshTasksWithOptions,
      clearBranchData: mock(() => {}),
      pullRequestSyncIntervalMs: 20,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
      return null;
    };

    const intervalController = createIntervalController();
    visibilityStateController.set("hidden");
    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      expect(refreshTasksWithOptions).not.toHaveBeenCalled();

      await harness.run(() => {
        visibilityStateController.set("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(refreshTasksWithOptions).not.toHaveBeenCalled();

      intervalController.tick();
      await harness.waitFor(() => refreshTasksWithOptions.mock.calls.length === 1);

      const visibleCallCount = refreshTasksWithOptions.mock.calls.length;
      expect(visibleCallCount).toBeGreaterThan(0);
      expect(refreshTasksWithOptions).toHaveBeenCalledWith({ trigger: "scheduled" });

      await harness.run(() => {
        visibilityStateController.set("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      });

      intervalController.tick();

      expect(refreshTasksWithOptions).toHaveBeenCalledTimes(visibleCallCount);

      await harness.run(() => {
        visibilityStateController.set("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(refreshTasksWithOptions).toHaveBeenCalledTimes(visibleCallCount);

      intervalController.tick();
      await harness.waitFor(
        () => refreshTasksWithOptions.mock.calls.length === visibleCallCount + 1,
      );

      expect(refreshTasksWithOptions.mock.calls.length).toBeGreaterThan(visibleCallCount);
    } finally {
      await harness.unmount();
      intervalController.restore();
    }
  });

  test("switches the periodic PR sync timer when the active repo changes", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTasksForRepoA = mock(async () => {});
    const refreshTasksForRepoB = mock(async () => {});
    const baseArgs: HookArgs = {
      activeRepo: "/repo-a",
      setEvents: mock((_updater) => {}),
      setRunCompletionSignal: mock((_runId: string, _eventType) => {}),
      refreshWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => {}),
      refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
      refreshBeadsCheckForRepo: mock(async () =>
        makeBeadsCheck({ beadsOk: true, beadsPath: "/repo-a/.beads", beadsError: null }),
      ),
      refreshTaskData: mock(async () => {}),
      refreshTasksWithOptions: refreshTasksForRepoA,
      clearBranchData: mock(() => {}),
      pullRequestSyncIntervalMs: 20,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
      return null;
    };

    const intervalController = createIntervalController();
    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();

      intervalController.tick();
      await harness.waitFor(() => refreshTasksForRepoA.mock.calls.length === 1);

      const repoACallCount = refreshTasksForRepoA.mock.calls.length;
      expect(repoACallCount).toBeGreaterThan(0);
      expect(refreshTasksForRepoB).not.toHaveBeenCalled();

      await harness.update({
        args: {
          ...baseArgs,
          activeRepo: "/repo-b",
          refreshTasksWithOptions: refreshTasksForRepoB,
        },
      });

      intervalController.tick();
      await harness.waitFor(() => refreshTasksForRepoB.mock.calls.length === 1);

      expect(refreshTasksForRepoA).toHaveBeenCalledTimes(repoACallCount);
      expect(refreshTasksForRepoB.mock.calls.length).toBeGreaterThan(0);
    } finally {
      await harness.unmount();
      intervalController.restore();
    }
  });

  test("keeps periodic PR sync active across parent rerenders such as route changes", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTasksWithOptions = mock(async () => {});
    const baseArgs: HookArgs = {
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
      refreshTasksWithOptions,
      clearBranchData: mock(() => {}),
      pullRequestSyncIntervalMs: 20,
    };

    const Harness = ({ args, route }: { args: HookArgs; route: string }) => {
      useAppLifecycle(args);
      return <div data-route={route} />;
    };

    const intervalController = createIntervalController();
    const harness = createSharedHookHarness(Harness, {
      args: baseArgs,
      route: "/kanban",
    });

    try {
      await harness.mount();

      intervalController.tick();
      await harness.waitFor(() => refreshTasksWithOptions.mock.calls.length === 1, 1000);

      await harness.update({
        args: baseArgs,
        route: "/agents",
      });

      expect(refreshTasksWithOptions).toHaveBeenCalledTimes(1);

      intervalController.tick();
      await harness.waitFor(() => refreshTasksWithOptions.mock.calls.length === 2, 1000);

      expect(refreshTasksWithOptions).toHaveBeenNthCalledWith(1, { trigger: "scheduled" });
      expect(refreshTasksWithOptions).toHaveBeenNthCalledWith(2, { trigger: "scheduled" });
    } finally {
      await harness.unmount();
      intervalController.restore();
    }
  });

  test("does not block repo diagnostics load on branch refresh completion", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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

  test("does not show Beads preparation toast when task loading is slow but Beads is already ready", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 15,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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

  test("uses structured repo-store health for repo-load failure messaging without showing ready success", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

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
      refreshTasksWithOptions: mock(async () => {}),
      clearBranchData: mock(() => {}),
      beadsPreparationToastDelayMs: 5,
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      useAppLifecycle(args);
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
        description:
          "Task store unavailable. Shared Dolt database repo_db is missing and restore is required Reopen the repository so OpenDucktor can restore the shared database from the attachment backup.",
      });
    } finally {
      beadsDeferred.resolve(makeBeadsCheck({ beadsPath: null }));
      taskDeferred.resolve();
      branchesDeferred.resolve();
      await harness.unmount();
    }
  });
});

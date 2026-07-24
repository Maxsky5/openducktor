import { describe, expect, mock, test } from "bun:test";
import type { TaskStoreCheck } from "@openducktor/contracts";
import { CancelledError } from "@tanstack/react-query";
import { createTaskStoreCheckFixture } from "@/test-utils/shared-test-fixtures";
import {
  type LifecycleNotificationPort,
  type LifecycleTimerPort,
  startRepositoryLoad,
} from "./app-lifecycle-coordinator";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createTimers = (): LifecycleTimerPort & { runAll: () => void; pending: () => number } => {
  const callbacks = new Set<() => void>();
  return {
    setTimeout: (callback) => {
      callbacks.add(callback);
      return callback;
    },
    clearTimeout: (timer) => callbacks.delete(timer as () => void),
    runAll: () => {
      for (const callback of callbacks) {
        callbacks.delete(callback);
        callback();
      }
    },
    pending: () => callbacks.size,
  };
};

const createNotifications = (): LifecycleNotificationPort => ({
  error: mock(() => {}),
  loading: mock(() => "preparing"),
  success: mock(() => {}),
  dismiss: mock(() => {}),
});

const readyCheck = (): TaskStoreCheck => createTaskStoreCheckFixture();
const blockingCheck = (): TaskStoreCheck =>
  createTaskStoreCheckFixture(
    {},
    {
      taskStoreOk: false,
      taskStorePath: null,
      taskStoreError: "SQLite task store database is unavailable",
      repoStoreHealth: {
        category: "database_unavailable",
        status: "blocking",
        isReady: false,
        detail: "SQLite task store database is unavailable",
        databasePath: null,
      },
    },
  );

type StartOverrides = Partial<
  Omit<Parameters<typeof startRepositoryLoad>[0], "notifications" | "timers">
>;

const start = (overrides: StartOverrides = {}) => {
  const timers = createTimers();
  const notifications = createNotifications();
  const refreshBranches = mock(async () => {});
  const refreshTaskStoreCheckForRepo = mock(async () => readyCheck());
  const loadWorkspaceTasks = mock(async () => {});
  const input = {
    repoPath: "/repo",
    isCurrent: () => true,
    refreshBranches,
    refreshTaskStoreCheckForRepo,
    loadWorkspaceTasks,
    notifications,
    timers,
    ...overrides,
  };
  const stop = startRepositoryLoad(input);
  return { ...input, stop };
};

describe("useAppLifecycle repository-load coordination", () => {
  test("does not show tasks unavailable when startup task loading is cancelled", async () => {
    const lifecycle = start({
      loadWorkspaceTasks: async () => {
        throw new CancelledError();
      },
    });
    await flush();
    expect(lifecycle.notifications.error).not.toHaveBeenCalledWith(
      "Repository tasks unavailable",
      expect.any(String),
    );
  });

  test("does not gate diagnostics and task loading on branch refresh completion", async () => {
    const branches = createDeferred<void>();
    const lifecycle = start({ refreshBranches: async () => await branches.promise });
    await flush();
    expect(lifecycle.refreshTaskStoreCheckForRepo).toHaveBeenCalledWith("/repo", false);
    expect(lifecycle.loadWorkspaceTasks).toHaveBeenCalledWith("/repo");
    branches.resolve();
  });

  test("suppresses late branch and task-load toasts after the repository is deselected", async () => {
    const branches = createDeferred<void>();
    const tasks = createDeferred<void>();
    let current = true;
    const lifecycle = start({
      isCurrent: () => current,
      refreshBranches: async () => await branches.promise,
      loadWorkspaceTasks: async () => await tasks.promise,
    });
    current = false;
    lifecycle.stop();
    branches.reject(new Error("branch failure"));
    tasks.reject(new Error("task failure"));
    await flush();
    expect(lifecycle.notifications.error).not.toHaveBeenCalled();
  });

  test("shows then dismisses preparation feedback, suppresses ready-first-check feedback, and clears it on failures", async () => {
    const check = createDeferred<TaskStoreCheck>();
    const tasks = createDeferred<void>();
    const slow = start({
      refreshTaskStoreCheckForRepo: async () => await check.promise,
      loadWorkspaceTasks: async () => await tasks.promise,
    });
    slow.timers.runAll();
    expect(slow.notifications.loading).toHaveBeenCalledWith(
      "Preparing task store",
      expect.any(String),
    );
    check.resolve(readyCheck());
    await flush();
    tasks.reject(new Error("task failure"));
    await flush();
    expect(slow.notifications.dismiss).toHaveBeenCalledWith("preparing");

    const readyFirst = start({
      loadWorkspaceTasks: async () => await createDeferred<void>().promise,
    });
    await flush();
    readyFirst.timers.runAll();
    expect(readyFirst.notifications.loading).not.toHaveBeenCalled();
    expect(readyFirst.timers.pending()).toBe(0);
    readyFirst.stop();

    const earlyFailure = start({
      refreshTaskStoreCheckForRepo: async () => {
        throw new Error("check failure");
      },
    });
    await flush();
    expect(earlyFailure.timers.pending()).toBe(0);
    earlyFailure.stop();
  });

  test("runs follow-up diagnostics after successful or cancelled initialization only for a blocking first check", async () => {
    const successful = start({ refreshTaskStoreCheckForRepo: mock(async () => blockingCheck()) });
    await flush();
    expect(successful.refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(1, "/repo", false);
    expect(successful.refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);

    const cancelled = start({
      refreshTaskStoreCheckForRepo: mock(async () => blockingCheck()),
      loadWorkspaceTasks: async () => {
        throw new CancelledError();
      },
    });
    await flush();
    expect(cancelled.refreshTaskStoreCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);

    const ready = start();
    await flush();
    expect(ready.refreshTaskStoreCheckForRepo).toHaveBeenCalledTimes(1);
  });

  test("preserves the primary task-load error when follow-up diagnostics fail", async () => {
    const primaryError = new Error("primary task failure");
    const lifecycle = start({
      refreshTaskStoreCheckForRepo: mock(async (_repoPath, force) => {
        if (force) {
          throw new Error("follow-up diagnostics failure");
        }
        return blockingCheck();
      }),
      loadWorkspaceTasks: async () => {
        throw primaryError;
      },
    });
    await flush();
    expect(lifecycle.notifications.error).toHaveBeenCalledWith(
      "Repository tasks unavailable",
      "primary task failure",
    );
  });
});

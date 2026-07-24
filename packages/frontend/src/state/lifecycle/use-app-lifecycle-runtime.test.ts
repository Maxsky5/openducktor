import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import {
  type LifecycleNotificationPort,
  type LifecycleTimerPort,
  startRepositoryRuntimes,
} from "./app-lifecycle-coordinator";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const createTimers = (): LifecycleTimerPort & { runAll: () => void } => {
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
  };
};

const notifications = (): LifecycleNotificationPort => ({
  error: mock(() => {}),
  loading: mock(() => "toast"),
  success: mock(() => {}),
  dismiss: mock(() => {}),
});

const runtime: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
};

describe("useAppLifecycle runtime coordination", () => {
  test("starts repository runtimes outside diagnostics without blocking independent mount work", async () => {
    const startup = createDeferred<RuntimeInstanceSummary>();
    const startRepoRuntime = mock(async () => await startup.promise);
    const refreshRepoRuntimeHealth = mock(async () => ({}));
    const timers = createTimers();
    const notices = notifications();

    const stop = startRepositoryRuntimes({
      repoPath: "/repo",
      runtimeKinds: ["opencode"],
      isCurrent: () => true,
      startRepoRuntime,
      refreshRepoRuntimeHealth,
      notifications: notices,
      timers,
    });
    const startBranchWork = mock(() => {});
    startBranchWork();

    expect(startRepoRuntime).toHaveBeenCalledWith("/repo", "opencode");
    expect(startBranchWork).toHaveBeenCalledTimes(1);
    expect(refreshRepoRuntimeHealth).not.toHaveBeenCalled();

    timers.runAll();
    expect(refreshRepoRuntimeHealth).toHaveBeenCalledTimes(1);

    startup.resolve(runtime);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshRepoRuntimeHealth).toHaveBeenCalledTimes(2);
    stop();
  });

  test("suppresses runtime startup errors after the repository is no longer current", async () => {
    const startup = createDeferred<RuntimeInstanceSummary>();
    const notices = notifications();
    let current = true;

    const stop = startRepositoryRuntimes({
      repoPath: "/repo",
      runtimeKinds: ["opencode"],
      isCurrent: () => current,
      startRepoRuntime: async () => await startup.promise,
      refreshRepoRuntimeHealth: async () => ({}),
      notifications: notices,
      timers: createTimers(),
    });

    current = false;
    stop();
    startup.resolve(runtime);
    await Promise.resolve();
    expect(notices.error).not.toHaveBeenCalled();
  });
});

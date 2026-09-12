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

type TestTimerHandle = { callback: () => void };

const createTimers = (): LifecycleTimerPort<TestTimerHandle> & { runAll: () => void } => {
  const timers = new Set<TestTimerHandle>();
  return {
    setTimeout: (callback) => {
      const timer = { callback };
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
    runAll: () => {
      for (const timer of timers) {
        timers.delete(timer);
        timer.callback();
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
  test("does not report cache refresh failures as runtime startup failures", async () => {
    const notices = notifications();
    const stop = startRepositoryRuntimes({
      repoPath: "/repo",
      runtimeKinds: ["opencode"],
      isCurrent: () => true,
      startRepoRuntime: async () => runtime,
      onRuntimeReady: async () => {
        throw new Error("cache unavailable");
      },
      refreshRepoRuntimeHealth: async () => ({}),
      notifications: notices,
      timers: createTimers(),
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(notices.error).toHaveBeenCalledTimes(1);
      expect(notices.error).toHaveBeenCalledWith(
        "Runtime data refresh failed for opencode",
        "cache unavailable",
      );
    } finally {
      stop();
    }
  });

  test("does not refresh runtime queries after startup fails", async () => {
    const notices = notifications();
    const onRuntimeReady = mock(async () => {});
    const stop = startRepositoryRuntimes({
      repoPath: "/repo",
      runtimeKinds: ["opencode"],
      isCurrent: () => true,
      startRepoRuntime: async () => {
        throw new Error("startup unavailable");
      },
      onRuntimeReady,
      refreshRepoRuntimeHealth: async () => ({}),
      notifications: notices,
      timers: createTimers(),
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(onRuntimeReady).not.toHaveBeenCalled();
      expect(notices.error).toHaveBeenCalledWith(
        "Runtime startup failed for opencode",
        "startup unavailable",
      );
    } finally {
      stop();
    }
  });

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
      onRuntimeReady: async () => {},
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
      onRuntimeReady: async () => {},
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

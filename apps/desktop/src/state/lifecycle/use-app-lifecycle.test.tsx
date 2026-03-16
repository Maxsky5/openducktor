import { describe, expect, mock, test } from "bun:test";
import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { ReactElement } from "react";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";

let subscribedRunListener: ((payload: unknown) => void) | null = null;

mock.module("@/lib/host-client", () => ({
  createHostClient: () =>
    createTauriHostClient(async () => {
      throw new Error("Tauri runtime not available. Run inside the desktop shell.");
    }),
  hostClient: createTauriHostClient(async () => {
    throw new Error("Tauri runtime not available. Run inside the desktop shell.");
  }),
  subscribeRunEvents: async (listener: (payload: unknown) => void) => {
    subscribedRunListener = listener;
    return () => {
      subscribedRunListener = null;
    };
  },
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

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

describe("useAppLifecycle", () => {
  test("refreshes active repo task data when a run completion event arrives", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    const refreshTaskData = mock(async (_repoPath: string) => {});
    const setRunCompletionSignal = mock((_runId: string, _eventType) => {});

    const Harness = ({ args }: { args: HookArgs }): ReactElement | null => {
      useAppLifecycle(args);
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, {
          args: {
            activeRepo: "/repo",
            setEvents: mock((_updater) => {}),
            setRunCompletionSignal,
            refreshWorkspaces: mock(async () => {}),
            refreshBranches: mock(async () => {}),
            refreshRuntimeCheck: mock(async () => ({ runtimeOk: true })),
            refreshBeadsCheckForRepo: mock(async () => ({
              beadsOk: true,
              beadsPath: "/repo/.beads",
              beadsError: null,
            })),
            refreshRepoRuntimeHealthForRepo: mock(async () => ({})),
            runtimeKinds: ["opencode"],
            refreshTaskData,
            clearTaskData: mock(() => {}),
            clearBranchData: mock(() => {}),
            clearActiveBeadsCheck: mock(() => {}),
            clearActiveRepoRuntimeHealth: mock(() => {}),
            setIsLoadingTasks: mock((_value: boolean) => {}),
            setIsLoadingChecks: mock((_value: boolean) => {}),
            hasRuntimeCheck: mock(() => true),
            hasCachedBeadsCheck: mock((_repoPath: string) => true),
            hasCachedRepoRuntimeHealth: mock((_repoPath: string, _runtimeKinds) => true),
          } satisfies HookArgs,
        }),
      );
    });
    await flush();

    refreshTaskData.mockClear();
    if (!subscribedRunListener) {
      throw new Error("Expected run event listener to be registered");
    }

    await act(async () => {
      subscribedRunListener?.({
        type: "run_finished",
        runId: "run-1",
        message: "done",
        timestamp: "2026-03-15T10:00:00.000Z",
        success: true,
      });
      await flush();
    });

    expect(setRunCompletionSignal).toHaveBeenCalledWith("run-1", "run_finished");
    expect(refreshTaskData).toHaveBeenCalledWith("/repo");

    await act(async () => {
      renderer?.unmount();
    });
  });

  test("clears task loading as soon as the repo task load finishes", async () => {
    const { useAppLifecycle } = await import("./use-app-lifecycle");
    type HookArgs = Parameters<typeof useAppLifecycle>[0];

    let currentArgs!: HookArgs;

    const Harness = ({ args }: { args: HookArgs }): ReactElement | null => {
      useAppLifecycle(args);
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    const mount = async (args: HookArgs): Promise<void> => {
      currentArgs = args;
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args }));
      });
      await flush();
    };
    const update = async (args: HookArgs): Promise<void> => {
      currentArgs = args;
      await act(async () => {
        renderer?.update(createElement(Harness, { args }));
      });
      await flush();
    };

    const taskLoadDeferred = createDeferred<void>();
    const runtimeRepoCheckDeferred = createDeferred<unknown>();
    const runtimeHealthDeferred = createDeferred<RepoRuntimeHealthMap>();
    const branchesDeferred = createDeferred<void>();
    const setIsLoadingTasks = mock((_value: boolean) => {});
    const setIsLoadingChecks = mock((_value: boolean) => {});

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
      refreshBeadsCheckForRepo: mock(async () => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      })),
      refreshRepoRuntimeHealthForRepo: mock(async () => runtimeHealthDeferred.promise),
      runtimeKinds: ["opencode"],
      refreshTaskData: mock(async () => taskLoadDeferred.promise),
      clearTaskData: mock(() => {}),
      clearBranchData: mock(() => {}),
      clearActiveBeadsCheck: mock(() => {}),
      clearActiveRepoRuntimeHealth: mock(() => {}),
      setIsLoadingTasks,
      setIsLoadingChecks,
      hasRuntimeCheck: mock(() => false),
      hasCachedBeadsCheck: mock((_repoPath: string) => false),
      hasCachedRepoRuntimeHealth: mock((_repoPath: string, _runtimeKinds) => false),
    };

    try {
      await mount(baseArgs);
      setIsLoadingTasks.mockClear();
      setIsLoadingChecks.mockClear();

      await update({
        ...currentArgs,
        activeRepo: "/repo",
      });

      expect(setIsLoadingTasks).toHaveBeenCalledWith(true);
      expect(setIsLoadingChecks).toHaveBeenCalledWith(true);

      await act(async () => {
        taskLoadDeferred.resolve();
        await flush();
      });

      expect(setIsLoadingTasks.mock.calls.some(([value]) => value === false)).toBe(true);
      expect(setIsLoadingChecks.mock.calls.some(([value]) => value === false)).toBe(false);

      await act(async () => {
        runtimeRepoCheckDeferred.resolve({ runtimeOk: true });
        runtimeHealthDeferred.resolve({});
        branchesDeferred.resolve();
        await flush();
      });

      expect(setIsLoadingChecks.mock.calls.some(([value]) => value === false)).toBe(true);
    } finally {
      taskLoadDeferred.resolve();
      runtimeRepoCheckDeferred.resolve({ runtimeOk: true });
      runtimeHealthDeferred.resolve({});
      branchesDeferred.resolve();
      await act(async () => {
        renderer?.unmount();
      });
    }
  });
});

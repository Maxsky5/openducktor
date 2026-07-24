import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskRefreshController } from "./task-refresh-controller";
import { useTaskRefreshFlow } from "./use-task-refresh-flow";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

const createDeferred = (): Deferred => {
  let resolve: (() => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve: () => resolve?.(),
    reject: (reason) => reject?.(reason),
  };
};

const createController = () => {
  const loadingStates: boolean[] = [];
  const errors: Array<{ title: string; description: string }> = [];
  const lastTaskRefreshToastRef = {
    current: null as { repoPath: string; description: string } | null,
  };
  const lastTaskLoadErrorToastRef = {
    current: null as { repoPath: string; description: string } | null,
  };
  const controller = createTaskRefreshController({
    setIsManualLoading: (value) => loadingStates.push(value),
    notificationPort: {
      error: (title, { description }) => errors.push({ title, description }),
    },
    lastTaskRefreshToastRef,
    lastTaskLoadErrorToastRef,
  });

  return { controller, errors, lastTaskLoadErrorToastRef, loadingStates };
};

describe("task refresh flow", () => {
  test("scheduled and manual refreshes join one in-flight repo task read", async () => {
    const { controller } = createController();
    const deferred = createDeferred();
    let readCount = 0;
    const refreshTaskData = async () => {
      readCount += 1;
      await deferred.promise;
    };

    const scheduled = controller.refresh({
      repoPath: "/repo",
      trigger: "scheduled",
      refreshTaskData,
    });
    const manual = controller.refresh({ repoPath: "/repo", trigger: "manual", refreshTaskData });
    expect(readCount).toBe(1);

    deferred.resolve();
    await Promise.all([scheduled, manual]);
  });

  test("joined scheduled and manual failures emit one notification", async () => {
    const { controller, errors } = createController();
    const deferred = createDeferred();
    const refreshTaskData = async () => deferred.promise;

    const scheduled = controller.refresh({
      repoPath: "/repo",
      trigger: "scheduled",
      refreshTaskData,
    });
    const manual = controller.refresh({ repoPath: "/repo", trigger: "manual", refreshTaskData });
    deferred.reject(new Error("task read failed"));
    await Promise.all([scheduled, manual]);

    expect(errors).toEqual([{ title: "Failed to refresh tasks", description: "task read failed" }]);
  });

  test("an earlier manual refresh does not clear a later refresh loading state", async () => {
    const { controller, loadingStates } = createController();
    const first = createDeferred();
    const second = createDeferred();
    const reads = [first, second];
    let readIndex = 0;
    const refreshTaskData = async () => reads[readIndex++]?.promise;

    const earlier = controller.refresh({ repoPath: "/repo-a", trigger: "manual", refreshTaskData });
    const later = controller.refresh({ repoPath: "/repo-b", trigger: "manual", refreshTaskData });
    first.resolve();
    await earlier;
    expect(loadingStates).toEqual([true, true]);

    second.resolve();
    await later;
    expect(loadingStates).toEqual([true, true, false]);
  });

  test("identical scheduled failures dedupe until a successful refresh resets the notification", async () => {
    const { controller, errors } = createController();
    const fail = async () => Promise.reject(new Error("task read failed"));

    await controller.refresh({ repoPath: "/repo", trigger: "scheduled", refreshTaskData: fail });
    await controller.refresh({ repoPath: "/repo", trigger: "scheduled", refreshTaskData: fail });
    await controller.refresh({
      repoPath: "/repo",
      trigger: "scheduled",
      refreshTaskData: async () => {},
    });
    await controller.refresh({ repoPath: "/repo", trigger: "scheduled", refreshTaskData: fail });

    expect(errors).toEqual([
      { title: "Failed to refresh tasks", description: "task read failed" },
      { title: "Failed to refresh tasks", description: "task read failed" },
    ]);
  });

  test("manual refresh reports a task read failure", async () => {
    const { controller, errors, lastTaskLoadErrorToastRef } = createController();

    await controller.refresh({
      repoPath: "/repo",
      trigger: "manual",
      refreshTaskData: async () => Promise.reject(new Error("task read failed")),
    });

    expect(lastTaskLoadErrorToastRef.current).toEqual({
      repoPath: "/repo",
      description: "task read failed",
    });
    expect(errors).toEqual([{ title: "Failed to refresh tasks", description: "task read failed" }]);
  });

  test("refreshes without diagnostics state", async () => {
    const { controller } = createController();
    let refreshCount = 0;

    await controller.refresh({
      repoPath: "/repo",
      trigger: "manual",
      refreshTaskData: async () => {
        refreshCount += 1;
      },
    });

    expect(refreshCount).toBe(1);
  });

  test("does not invoke a refresh without an active repo", async () => {
    let refreshCount = 0;
    const harness = createHookHarness(useTaskRefreshFlow, {
      activeRepoPath: null,
      refreshTaskData: async () => {
        refreshCount += 1;
      },
      lastTaskRefreshToastRef: { current: null },
      lastTaskLoadErrorToastRef: { current: null },
    });
    await harness.mount();

    await act(async () => {
      await harness.getLatest().refreshTasks();
    });

    expect(refreshCount).toBe(0);
    await harness.unmount();
  });
});

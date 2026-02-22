import { describe, expect, mock, test } from "bun:test";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskHydration>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskHydration, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo-a",
  activeTaskId: "task-1",
  tabTaskIds: [],
  loadAgentSessions: async () => {},
  ...overrides,
});

describe("useAgentStudioTaskHydration", () => {
  test("hydrates the active task once and marks it hydrated", async () => {
    const deferred = createDeferred<void>();
    const loadAgentSessions = mock((taskId: string) => {
      if (taskId !== "task-1") {
        return Promise.resolve();
      }
      return deferred.promise;
    });

    const args = createBaseArgs({ loadAgentSessions });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      expect(loadAgentSessions).toHaveBeenCalledTimes(1);
      expect(loadAgentSessions).toHaveBeenCalledWith("task-1");
      expect(harness.getLatest()["/repo-a:task-1"]).toBeUndefined();

      await harness.run(async () => {
        deferred.resolve(undefined);
        await deferred.promise;
      });

      await harness.waitFor((state) => state["/repo-a:task-1"] === true);

      await harness.update(args);
      expect(loadAgentSessions).toHaveBeenCalledTimes(1);
    } finally {
      deferred.resolve(undefined);
      await harness.unmount();
    }
  });

  test("hydrates tab tasks in the background and skips duplicates/active task", async () => {
    const deferredByTask = new Map<string, ReturnType<typeof createDeferred<void>>>([
      ["task-1", createDeferred<void>()],
      ["task-2", createDeferred<void>()],
      ["task-3", createDeferred<void>()],
    ]);
    const loadAgentSessions = mock((taskId: string) => {
      const deferred = deferredByTask.get(taskId);
      if (!deferred) {
        return Promise.resolve();
      }
      return deferred.promise;
    });

    const args = createBaseArgs({
      tabTaskIds: ["task-1", "task-2", "task-3", "task-2"],
      loadAgentSessions,
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      expect(loadAgentSessions).toHaveBeenCalledTimes(3);
      expect(loadAgentSessions).toHaveBeenCalledWith("task-1");
      expect(loadAgentSessions).toHaveBeenCalledWith("task-2");
      expect(loadAgentSessions).toHaveBeenCalledWith("task-3");

      await harness.update(args);
      expect(loadAgentSessions).toHaveBeenCalledTimes(3);

      await harness.run(async () => {
        deferredByTask.get("task-1")?.resolve(undefined);
        deferredByTask.get("task-2")?.resolve(undefined);
        deferredByTask.get("task-3")?.resolve(undefined);
        await Promise.all([...deferredByTask.values()].map((entry) => entry.promise));
      });

      await harness.waitFor(
        (state) =>
          state["/repo-a:task-1"] === true &&
          state["/repo-a:task-2"] === true &&
          state["/repo-a:task-3"] === true,
      );
    } finally {
      for (const deferred of deferredByTask.values()) {
        deferred.resolve(undefined);
      }
      await harness.unmount();
    }
  });

  test("marks a task hydrated even when loading sessions rejects", async () => {
    const deferred = createDeferred<void>();
    const loadAgentSessions = mock(async () => {
      try {
        await deferred.promise;
      } catch {}
    });

    const harness = createHookHarness(createBaseArgs({ loadAgentSessions }));

    try {
      await harness.mount();

      await harness.run(async () => {
        deferred.reject(new Error("load failed"));
        try {
          await deferred.promise;
        } catch {}
      });

      await harness.waitFor((state) => state["/repo-a:task-1"] === true);
      expect(loadAgentSessions).toHaveBeenCalledTimes(1);
    } finally {
      deferred.resolve(undefined);
      await harness.unmount();
    }
  });

  test("clears hydration cache when repo changes and requests hydration again", async () => {
    const firstLoad = createDeferred<void>();
    const secondLoad = createDeferred<void>();
    let loadCount = 0;
    const loadAgentSessions = mock(() => {
      loadCount += 1;
      return loadCount === 1 ? firstLoad.promise : secondLoad.promise;
    });
    const harness = createHookHarness(createBaseArgs({ loadAgentSessions }));

    try {
      await harness.mount();

      await harness.run(async () => {
        firstLoad.resolve(undefined);
        await firstLoad.promise;
      });
      await harness.waitFor((state) => state["/repo-a:task-1"] === true);

      await harness.update(
        createBaseArgs({
          activeRepo: "/repo-b",
          activeTaskId: "task-1",
          tabTaskIds: [],
          loadAgentSessions,
        }),
      );

      await harness.waitFor((state) => state["/repo-a:task-1"] === undefined);
      expect(loadAgentSessions).toHaveBeenCalledTimes(2);
    } finally {
      firstLoad.resolve(undefined);
      secondLoad.resolve(undefined);
      await harness.unmount();
    }
  });
});

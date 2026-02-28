import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";
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
  activeSessionId: null,
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

  test("loads message history only for the active session", async () => {
    const loadAgentSessions = mock(
      async (_taskId: string, _options?: AgentSessionLoadOptions): Promise<void> => {},
    );
    const harness = createHookHarness(
      createBaseArgs({
        activeSessionId: "session-1",
        loadAgentSessions,
      }),
    );

    try {
      await harness.mount();

      expect(loadAgentSessions).toHaveBeenCalledTimes(2);
      expect(loadAgentSessions.mock.calls[0]).toEqual(["task-1"]);
      expect(loadAgentSessions.mock.calls[1]).toEqual([
        "task-1",
        { hydrateHistoryForSessionId: "session-1" },
      ]);

      await harness.update(
        createBaseArgs({
          activeSessionId: "session-1",
          loadAgentSessions,
        }),
      );
      expect(loadAgentSessions).toHaveBeenCalledTimes(2);

      await harness.update(
        createBaseArgs({
          activeSessionId: "session-2",
          loadAgentSessions,
        }),
      );

      expect(loadAgentSessions).toHaveBeenCalledTimes(3);
      expect(loadAgentSessions.mock.calls[2]).toEqual([
        "task-1",
        { hydrateHistoryForSessionId: "session-2" },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("marks a task hydrated even when loading sessions rejects", async () => {
    const deferred = createDeferred<void>();
    const loadError = new Error("load failed");
    const loadAgentSessions = mock(() => {
      const promise = deferred.promise;
      const originalFinally = promise.finally.bind(promise);
      promise.finally = ((onFinally) => {
        const finalPromise = originalFinally(onFinally);
        void finalPromise.catch(() => undefined);
        return finalPromise;
      }) as Promise<void>["finally"];
      return promise;
    });

    const harness = createHookHarness(createBaseArgs({ loadAgentSessions }));

    try {
      await harness.mount();
      const rejectionCapture = deferred.promise.then(
        () => null,
        (error: unknown) => error,
      );

      await harness.run(() => {
        deferred.reject(loadError);
      });

      const capturedError = await rejectionCapture;
      expect(capturedError).toBe(loadError);

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
          activeSessionId: null,
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

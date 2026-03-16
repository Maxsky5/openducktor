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
      expect(harness.getLatest().hydratedTasksByRepoAndTask["/repo-a:task-1"]).toBeUndefined();

      await harness.run(async () => {
        deferred.resolve(undefined);
        await deferred.promise;
      });

      await harness.waitFor((state) => state.hydratedTasksByRepoAndTask["/repo-a:task-1"] === true);

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

      expect(loadAgentSessions).toHaveBeenCalledTimes(1);
      expect(loadAgentSessions.mock.calls[0]).toEqual([
        "task-1",
        { hydrateHistoryForSessionId: "session-1" },
      ]);
      await harness.waitFor((state) => state.hydratedTasksByRepoAndTask["/repo-a:task-1"] === true);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);

      await harness.update(
        createBaseArgs({
          activeSessionId: "session-1",
          loadAgentSessions,
        }),
      );
      expect(loadAgentSessions).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeSessionId: "session-2",
          loadAgentSessions,
        }),
      );

      expect(loadAgentSessions).toHaveBeenCalledTimes(2);
      expect(loadAgentSessions.mock.calls[1]).toEqual([
        "task-1",
        { hydrateHistoryForSessionId: "session-2" },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps a task unhydrated when loading sessions rejects", async () => {
    const loadError = new Error("load failed");
    let loadCount = 0;
    const loadAgentSessions = mock(async () => {
      loadCount += 1;
      if (loadCount === 1) {
        throw loadError;
      }
    });
    const args = createBaseArgs({ loadAgentSessions });
    const harness = createHookHarness(args);

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessions.mock.calls.length === 1);
      expect(harness.getLatest().hydratedTasksByRepoAndTask["/repo-a:task-1"]).toBeUndefined();
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(true);
      expect(loadAgentSessions).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeTaskId: "task-2",
          loadAgentSessions,
        }),
      );
      await harness.waitFor(() => loadAgentSessions.mock.calls.length === 2);
      expect(harness.getLatest().hydratedTasksByRepoAndTask["/repo-a:task-2"]).toBe(true);

      await harness.update(args);
      await harness.waitFor(() => loadAgentSessions.mock.calls.length === 3);
      expect(harness.getLatest().hydratedTasksByRepoAndTask["/repo-a:task-1"]).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("marks session history hydration as failed when loading history rejects", async () => {
    const loadAgentSessions = mock(async (_taskId: string, options?: AgentSessionLoadOptions) => {
      if (options?.hydrateHistoryForSessionId === "session-1") {
        throw new Error("history failed");
      }
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeSessionId: "session-1",
        loadAgentSessions,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessions.mock.calls.length === 1);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
    } finally {
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
      await harness.waitFor((state) => state.hydratedTasksByRepoAndTask["/repo-a:task-1"] === true);

      await harness.update(
        createBaseArgs({
          activeRepo: "/repo-b",
          activeTaskId: "task-1",
          activeSessionId: null,
          loadAgentSessions,
        }),
      );

      await harness.waitFor(
        (state) => state.hydratedTasksByRepoAndTask["/repo-a:task-1"] === undefined,
      );
      expect(loadAgentSessions).toHaveBeenCalledTimes(2);
    } finally {
      firstLoad.resolve(undefined);
      secondLoad.resolve(undefined);
      await harness.unmount();
    }
  });

  test("marks task as hydrated even when cancelled in-flight load completes successfully", async () => {
    const firstTaskLoad = createDeferred<void>();
    let taskOneLoadCount = 0;
    const loadAgentSessions = mock(async (taskId: string) => {
      if (taskId === "task-1") {
        taskOneLoadCount += 1;
        return firstTaskLoad.promise;
      }
    });
    const harness = createHookHarness(createBaseArgs({ loadAgentSessions }));

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessions.mock.calls.length === 1);

      // Switch away to task-2 — this cancels the in-flight task-1 load
      await harness.update(
        createBaseArgs({
          activeTaskId: "task-2",
          loadAgentSessions,
        }),
      );
      await harness.waitFor(() => loadAgentSessions.mock.calls.length === 2);

      // Switch back to task-1 — the cancelled load hasn't resolved yet
      await harness.update(createBaseArgs({ loadAgentSessions }));
      expect(loadAgentSessions.mock.calls.length).toBe(2);

      // Resolve the first (cancelled) load — it should still mark task-1 as hydrated
      await harness.run(async () => {
        firstTaskLoad.resolve(undefined);
        await firstTaskLoad.promise;
      });

      // The cancelled-but-successful load marks hydration complete — no retry needed
      await harness.waitFor((state) => state.hydratedTasksByRepoAndTask["/repo-a:task-1"] === true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      // No 3rd call needed — the cancelled load's success was recognized
      expect(taskOneLoadCount).toBe(1);
    } finally {
      firstTaskLoad.resolve(undefined);
      await harness.unmount();
    }
  });
});

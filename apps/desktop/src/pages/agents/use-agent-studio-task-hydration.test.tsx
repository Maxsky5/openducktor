import { describe, expect, mock, test } from "bun:test";
import {
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
  hydrateRequestedTaskSessionHistory: async () => {},
  ...overrides,
});

describe("useAgentStudioTaskHydration", () => {
  test("treats the selected task as hydrated once repo and task are known", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      expect(harness.getLatest().isActiveTaskHydrated).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("hydrates message history only for the active session", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSessionId: "session-1",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrated);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });

      await harness.update(
        createBaseArgs({
          activeSessionId: "session-1",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeSessionId: "session-2",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 2);
    } finally {
      await harness.unmount();
    }
  });

  test("marks session history hydration as failed when the query rejects", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async () => {
      throw new Error("history failed");
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeSessionId: "session-1",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrationFailed);

      expect(harness.getLatest().isActiveTaskHydrated).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});

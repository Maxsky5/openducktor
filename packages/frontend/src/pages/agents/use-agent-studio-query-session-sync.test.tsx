import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioQuerySessionSync } from "./use-agent-studio-query-session-sync";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioQuerySessionSync>[0];

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (taskId: string, externalSessionId: string) =>
  createAgentSessionFixture({
    externalSessionId: `ext-${externalSessionId}`,
    taskId,
  });

const useHookHarness = (props: HookArgs) => {
  useAgentStudioQuerySessionSync(props);
  return { ready: true };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useHookHarness, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  isRepoNavigationBoundaryPending: false,
  isLoadingTasks: false,
  tasks: [createTask("task-1")],
  taskIdParam: "task-1",
  sessionParam: null,
  selectedSessionById: null,
  taskId: "task-1",
  activeSession: null,
  roleFromQuery: "spec",
  isActiveTaskHydrated: true,
  scheduleQueryUpdate: () => {},
  ...overrides,
});

describe("useAgentStudioQuerySessionSync", () => {
  test("clears query when URL task no longer exists", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const harness = createHookHarness(
      createBaseArgs({
        tasks: [createTask("task-1")],
        taskIdParam: "missing-task",
        taskId: "missing-task",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([
        {
          task: undefined,
          session: undefined,
          agent: undefined,
          autostart: undefined,
          start: undefined,
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("backfills missing task param from selected session", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const selectedSession = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        tasks: [createTask("task-1"), createTask("task-2")],
        taskIdParam: "",
        sessionParam: "session-2",
        selectedSessionById: selectedSession,
        taskId: "task-2",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([{ task: "task-2" }]);
    } finally {
      await harness.unmount();
    }
  });

  test("does not clear a session deep link before session reconciliation can repair it", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const harness = createHookHarness(
      createBaseArgs({
        tasks: [createTask("task-1")],
        taskIdParam: "missing-task",
        sessionParam: "session-2",
        taskId: "",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();
      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("skips query reconciliation while repo navigation boundary reset is pending", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const selectedSession = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        isRepoNavigationBoundaryPending: true,
        tasks: [createTask("task-1"), createTask("task-2")],
        taskIdParam: "task-1",
        sessionParam: "session-2",
        selectedSessionById: selectedSession,
        taskId: "task-1",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();
      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("corrects the task when a resolved session belongs to another task", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const selectedSession = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        tasks: [createTask("task-1"), createTask("task-2")],
        taskIdParam: "task-1",
        sessionParam: "session-2",
        selectedSessionById: selectedSession,
        taskId: "task-1",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([{ task: "task-2" }]);
    } finally {
      await harness.unmount();
    }
  });

  test("aligns query params with resolved active session when session param is present", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const activeSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "planner",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        sessionParam: "stale-session-id",
        selectedSessionById: activeSession,
        taskId: "task-1",
        activeSession,
        roleFromQuery: "spec",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([
        {
          session: "ext-session-1",
          agent: "planner",
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("does not repin session when query intentionally omits session", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const activeSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "spec",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        sessionParam: null,
        taskId: "task-1",
        activeSession,
        roleFromQuery: "spec",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();
      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("does not repin build selection for review tasks during task-only navigation", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const activeSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-build",
      taskId: "task-1",
      role: "build",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        sessionParam: null,
        taskId: "task-1",
        activeSession,
        roleFromQuery: "qa",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();
      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});

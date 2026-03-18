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

const createSession = (taskId: string, sessionId: string) =>
  createAgentSessionFixture({
    sessionId,
    externalSessionId: `ext-${sessionId}`,
    taskId,
  });

const useHookHarness = (props: HookArgs) => {
  useAgentStudioQuerySessionSync(props);
  return { ready: true };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useHookHarness, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
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
      sessionId: "session-1",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "planner",
      scenario: "planner_initial",
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
          session: "session-1",
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
      sessionId: "session-1",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
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
});

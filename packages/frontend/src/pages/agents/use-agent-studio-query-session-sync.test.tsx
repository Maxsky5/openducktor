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
  sessionFromQuery: null,
  resolvedTaskId: "task-1",
  resolvedSession: null,
  roleFromQuery: "spec",
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
        resolvedTaskId: "missing-task",
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
        sessionParam: "ext-session-2",
        sessionFromQuery: selectedSession,
        resolvedTaskId: "task-2",
        resolvedSession: selectedSession,
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

  test("does not clear a session deep link before the session catalog can resolve it", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const harness = createHookHarness(
      createBaseArgs({
        tasks: [createTask("task-1")],
        taskIdParam: "missing-task",
        sessionParam: "session-2",
        resolvedTaskId: "",
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

  test("clears stale session selection for an existing reset task before workflow readiness", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const harness = createHookHarness(
      createBaseArgs({
        tasks: [createTask("task-1")],
        taskIdParam: "task-1",
        sessionParam: "removed-session",
        sessionFromQuery: null,
        resolvedTaskId: "task-1",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([{ session: undefined }]);
    } finally {
      await harness.unmount();
    }
  });

  test("skips query sync while repo navigation boundary reset is pending", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const selectedSession = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        isRepoNavigationBoundaryPending: true,
        tasks: [createTask("task-1"), createTask("task-2")],
        taskIdParam: "task-1",
        sessionParam: "ext-session-2",
        sessionFromQuery: selectedSession,
        resolvedTaskId: "task-1",
        resolvedSession: selectedSession,
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
        sessionParam: "ext-session-2",
        sessionFromQuery: selectedSession,
        resolvedTaskId: "task-1",
        resolvedSession: null,
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

  test("aligns the role param with the resolved session when a session param is present", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const resolvedSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "planner",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        sessionParam: "ext-session-1",
        sessionFromQuery: resolvedSession,
        resolvedTaskId: "task-1",
        resolvedSession,
        roleFromQuery: "spec",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([
        {
          agent: "planner",
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("aligns missing task and stale role in one query update", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const resolvedSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "planner",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "",
        sessionParam: "ext-session-1",
        sessionFromQuery: resolvedSession,
        resolvedTaskId: "task-1",
        resolvedSession,
        roleFromQuery: "spec",
        scheduleQueryUpdate,
      }),
    );

    try {
      await harness.mount();

      expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);
      expect(scheduleQueryUpdate.mock.calls[0]).toEqual([
        {
          task: "task-1",
          agent: "planner",
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("does not repin session when query intentionally omits session", async () => {
    const scheduleQueryUpdate = mock((_updates: Record<string, string | undefined>) => {});
    const resolvedSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "spec",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        sessionParam: null,
        resolvedTaskId: "task-1",
        resolvedSession,
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
    const resolvedSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-build",
      taskId: "task-1",
      role: "build",
    });
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        sessionParam: null,
        resolvedTaskId: "task-1",
        resolvedSession,
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

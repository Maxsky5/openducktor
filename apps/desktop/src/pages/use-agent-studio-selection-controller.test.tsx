import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSelectionController } from "./use-agent-studio-selection-controller";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSelectionController>[0];

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (
  taskId: string,
  sessionId: string,
  overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {},
) =>
  createAgentSessionFixture({
    sessionId,
    externalSessionId: `ext-${sessionId}`,
    taskId,
    ...overrides,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioSelectionController, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: null,
  tasks: [createTask("task-1"), createTask("task-2")],
  isLoadingTasks: false,
  sessions: [],
  taskIdParam: "task-1",
  sessionParam: null,
  hasExplicitRoleParam: false,
  roleFromQuery: "spec",
  scenarioFromQuery: "spec_initial",
  sessionStartPreference: null,
  updateQuery: () => {},
  loadAgentSessions: async () => {},
  clearComposerInput: () => {},
  ...overrides,
});

describe("useAgentStudioSelectionController", () => {
  test("resolves task context from selected session when task param is missing", async () => {
    const session = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        sessions: [session],
        taskIdParam: "",
        sessionParam: "session-2",
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.taskId).toBe("task-2");
      expect(latest.selectedTask?.id).toBe("task-2");
      expect(latest.activeSession?.sessionId).toBe("session-2");
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewActiveSession?.sessionId).toBe("session-2");
    } finally {
      await harness.unmount();
    }
  });

  test("uses detached tab context instead of query role selection", async () => {
    const updateQuery = mock(() => {});
    const clearComposerInput = mock(() => {});
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
        scenarioFromQuery: "build_implementation_start",
        updateQuery,
        clearComposerInput,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      const latest = harness.getLatest();
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewRole).toBe("spec");
      expect(latest.viewScenario).toBe("spec_initial");
      expect(clearComposerInput).toHaveBeenCalledTimes(1);
      expect(updateQuery).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("resolves view session from the UI-active task tab", async () => {
    const sessionTaskOne = createSession("task-1", "session-1", {
      role: "planner",
      scenario: "planner_initial",
      startedAt: "2026-02-22T12:00:00.000Z",
    });
    const sessionTaskTwo = createSession("task-2", "session-2", {
      role: "qa",
      scenario: "qa_review",
      startedAt: "2026-02-22T13:00:00.000Z",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [sessionTaskOne, sessionTaskTwo],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().viewActiveSession?.sessionId).toBe("session-1");

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      const latest = harness.getLatest();
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewActiveSession?.sessionId).toBe("session-2");
      expect(latest.viewRole).toBe("qa");
      expect(latest.viewScenario).toBe("qa_review");
    } finally {
      await harness.unmount();
    }
  });
});

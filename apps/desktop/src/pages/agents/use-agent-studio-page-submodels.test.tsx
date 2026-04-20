import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioHeaderModel>[0];

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  selectedTask: {
    id: "task-1",
    title: "Task 1",
    description: "",
    notes: "",
    status: "open",
    priority: 2,
    issueType: "task",
    aiReviewEnabled: true,
    availableActions: [],
    labels: [],
    parentId: undefined,
    subtaskIds: [],
    assignee: undefined,
    documentSummary: {
      spec: { has: false },
      plan: { has: false },
      qaReport: { has: false, verdict: "not_reviewed" },
    },
    agentWorkflows: {
      spec: { required: true, canSkip: false, available: true, completed: false },
      planner: { required: true, canSkip: false, available: true, completed: false },
      builder: { required: true, canSkip: false, available: true, completed: false },
      qa: { required: true, canSkip: false, available: false, completed: false },
    },
    updatedAt: "2026-02-22T12:00:00.000Z",
    createdAt: "2026-02-22T12:00:00.000Z",
  },
  onOpenTaskDetails: mock(() => {}),
  activeSession: { status: "running" },
  sessionsForTaskLength: 1,
  contextSessionsLength: 1,
  agentStudioReady: true,
  isStarting: false,
  onWorkflowStepSelect: mock(() => {}),
  onSessionSelectionChange: mock(() => {}),
  onCreateSession: mock(() => {}),
  workflow: {
    workflowStateByRole: {
      spec: {
        tone: "in_progress",
        availability: "available",
        completion: "in_progress",
        liveSession: "running",
      },
      planner: {
        tone: "available",
        availability: "available",
        completion: "not_started",
        liveSession: "none",
      },
      build: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      qa: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
    },
    selectedInteractionRole: "spec",
    workflowSessionByRole: {
      spec: {
        role: "spec",
        sessionId: "session-1",
        scenario: "spec_initial",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: "running",
        taskId: "task-1",
        pendingPermissions: [],
        pendingQuestions: [],
      },
      planner: null,
      build: null,
      qa: null,
    },
    sessionSelectorAutofocusByValue: { "session-1": true },
    sessionSelectorValue: "session-1",
    sessionSelectorGroups: [
      {
        label: "Spec",
        options: [{ value: "session-1", label: "Spec session" }],
      },
    ],
    sessionCreateOptions: [],
    createSessionDisabled: false,
  },
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioHeaderModel, initialProps);

describe("useAgentStudioHeaderModel", () => {
  test("builds workflow header state from the workflow adapter context", async () => {
    const harness = createHookHarness(createHookArgs());

    await act(async () => {
      await harness.mount();
    });

    const model = harness.getLatest();
    expect(model.taskTitle).toBe("Task 1");
    expect(model.selectedRole).toBe("spec");
    expect(model.workflowSteps[0]?.sessionId).toBe("session-1");
    expect(model.sessionSelector.disabled).toBe(false);
    expect(model.sessionSelector.shouldAutofocusComposerForValue("session-1")).toBe(true);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("clears task details navigation when no task is selected", async () => {
    const harness = createHookHarness(
      createHookArgs({
        selectedTask: null,
        activeSession: null,
        sessionsForTaskLength: 0,
      }),
    );

    await act(async () => {
      await harness.mount();
    });

    expect(harness.getLatest().taskTitle).toBeNull();
    expect(harness.getLatest().onOpenTaskDetails).toBeNull();

    await act(async () => {
      await harness.unmount();
    });
  });
});

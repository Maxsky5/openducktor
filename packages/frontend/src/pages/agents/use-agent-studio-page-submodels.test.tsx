import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioHeaderModel>[0];

const specSessionSelectorValue = agentSessionIdentityKey({
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
});

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  selectedTask: {
    id: "task-1",
    title: "Task 1",
    description: "",
    status: "open",
    priority: 2,
    issueType: "task",
    aiReviewEnabled: true,
    availableActions: [],
    labels: [],
    parentId: undefined,
    subtaskIds: [],
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
  selectedRole: "spec",
  sessionsForTaskLength: 1,
  agentStudioReady: true,
  isStarting: false,
  onWorkflowStepSelect: mock(() => {}),
  onSessionSelectionChange: mock(() => {}),
  onPrepareMessageFirstSession: mock(() => {}),
  onQuickAction: mock(() => {}),
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
    workflowSessionByRole: {
      spec: {
        role: "spec",
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        startedAt: "2026-02-22T12:00:00.000Z",
        activityState: "running",
        taskId: "task-1",
      },
      planner: null,
      build: null,
      qa: null,
    },
    sessionSelectorAutofocusByValue: { [specSessionSelectorValue]: true },
    sessionSelectorValue: specSessionSelectorValue,
    sessionSelectorGroups: [
      {
        label: "Spec",
        options: [{ value: specSessionSelectorValue, label: "Spec session" }],
      },
    ],
    sessionCreateOptions: [],
    quickActions: [],
    primaryQuickAction: null,
  },
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioHeaderModel, initialProps);

describe("useAgentStudioHeaderModel", () => {
  test("builds workflow header state from the workflow adapter context", async () => {
    const onPrepareMessageFirstSession = mock(() => {});
    const onQuickAction = mock(() => {});
    const onResolveGitConflictQuickAction = mock(() => {});
    const sessionCreateOption = {
      id: "build:build_implementation_start:message_first",
      role: "build" as const,
      launchActionId: "build_implementation_start" as const,
      label: "Prepare Builder session",
      description: "Open a Builder composer without sending a kickoff.",
      disabled: false,
    };
    const quickAction = {
      id: "quick:build_implementation_start",
      role: "build" as const,
      launchActionId: "build_implementation_start" as const,
      label: "Start Implementation",
      description: "Open the start-session flow for Builder implementation work.",
      postStartAction: "kickoff" as const,
      disabled: false,
    };
    const harness = createHookHarness(
      createHookArgs({
        onPrepareMessageFirstSession,
        onQuickAction,
        onResolveGitConflictQuickAction,
        workflow: {
          ...createHookArgs().workflow,
          sessionCreateOptions: [sessionCreateOption],
          quickActions: [quickAction],
          primaryQuickAction: quickAction,
        },
      }),
    );

    await act(async () => {
      await harness.mount();
    });

    const model = harness.getLatest();
    expect(model.taskTitle).toBe("Task 1");
    expect(model.selectedRole).toBe("spec");
    expect(model.workflowSteps[0]?.sessionValue).toBe(specSessionSelectorValue);
    expect(model.sessionSelector.disabled).toBe(false);
    expect(model.sessionSelector.shouldAutofocusComposerForValue(specSessionSelectorValue)).toBe(
      true,
    );
    expect(model.sessionCreateOptions).toEqual([sessionCreateOption]);
    expect(model.quickActions).toEqual([quickAction]);
    expect(model.primaryQuickAction).toEqual(quickAction);
    expect(model.onResolveGitConflictQuickAction).toBe(onResolveGitConflictQuickAction);

    model.onPrepareMessageFirstSession(sessionCreateOption);
    model.onQuickAction(quickAction);
    model.onResolveGitConflictQuickAction?.();

    expect(onPrepareMessageFirstSession).toHaveBeenCalledWith(sessionCreateOption);
    expect(onQuickAction).toHaveBeenCalledWith(quickAction);
    expect(onResolveGitConflictQuickAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("clears task details navigation when no task is selected", async () => {
    const harness = createHookHarness(
      createHookArgs({
        selectedTask: null,
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

import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  coerceVisibleSelectionToCatalog,
  emptyDraftSelections,
  extractCompletionTimestamp,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
  resolveAgentStudioDefaultRoleForTask,
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
  toContextStorageKey,
  toRightPanelStorageKey,
  toTabsStorageKey,
} from "./agents-page-selection";

const resolveAgentStudioActiveSession = (args: {
  sessionsForTask: Parameters<typeof resolveAgentStudioSessionSelection>[0]["sessionsForTask"];
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: Parameters<typeof resolveAgentStudioSessionSelection>[0]["roleFromQuery"];
  selectedTask: Parameters<typeof resolveAgentStudioSessionSelection>[0]["selectedTask"];
}) => {
  return resolveAgentStudioSessionSelection({
    ...args,
    fallbackRole: args.roleFromQuery,
    scenarioFromQuery: null,
  }).activeSession;
};

const catalogFixture: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "fast"],
    },
    {
      id: "anthropic/claude-sonnet-4",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet-4",
      modelName: "Claude Sonnet 4",
      variants: [],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [
    { name: "spec", mode: "primary" },
    { name: "qa", mode: "all" },
    { name: "hidden-subagent", mode: "subagent", hidden: true },
  ],
};

describe("agents-page-selection", () => {
  test("builds storage keys and empty role selections", () => {
    expect(toContextStorageKey("workspace-repo")).toBe(
      "openducktor:agent-studio:context:workspace-repo",
    );
    expect(toTabsStorageKey("workspace-repo")).toBe("openducktor:agent-studio:tabs:workspace-repo");
    expect(toRightPanelStorageKey()).toBe("openducktor:agent-studio:right-panel");
    expect(emptyDraftSelections()).toEqual({ spec: null, planner: null, build: null, qa: null });
  });

  test("extracts completion timestamp from tool output", () => {
    const value = "Done at 2026-02-01T12:10:00.000Z";
    const extracted = extractCompletionTimestamp(value);
    expect(extracted?.raw).toBe("2026-02-01T12:10:00.000Z");
    expect(extractCompletionTimestamp("not a timestamp")).toBeNull();
  });

  test("picks default model + primary agent", () => {
    expect(pickDefaultVisibleSelectionForCatalog(catalogFixture)).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec",
    });
  });

  test("matches provider defaults by provider and model id", () => {
    const providerCollisionCatalog: AgentModelCatalog = {
      models: [
        {
          id: "openai/shared-model",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "shared-model",
          modelName: "OpenAI Shared",
          variants: ["default"],
        },
        {
          id: "anthropic/shared-model",
          providerId: "anthropic",
          providerName: "Anthropic",
          modelId: "shared-model",
          modelName: "Anthropic Shared",
          variants: ["balanced"],
        },
      ],
      defaultModelsByProvider: {
        anthropic: "shared-model",
      },
      profiles: [],
    };

    expect(pickDefaultVisibleSelectionForCatalog(providerCollisionCatalog)).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "shared-model",
      variant: "balanced",
    });
  });

  test("coerces a visible picker selection to the current catalog", () => {
    expect(
      coerceVisibleSelectionToCatalog(catalogFixture, {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "not-supported",
        profileId: "hidden-subagent",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      coerceVisibleSelectionToCatalog(catalogFixture, {
        runtimeKind: "opencode",
        providerId: "unknown",
        modelId: "missing",
      }),
    ).toBeNull();
  });

  test("compares selections by full tuple", () => {
    expect(isSameSelection(null, null)).toBe(true);
    expect(
      isSameSelection(
        { providerId: "openai", modelId: "gpt-5", variant: "default", profileId: "spec" },
        { providerId: "openai", modelId: "gpt-5", variant: "default", profileId: "spec" },
      ),
    ).toBe(true);
    expect(
      isSameSelection(
        { providerId: "openai", modelId: "gpt-5" },
        { providerId: "openai", modelId: "gpt-5", variant: "fast" },
      ),
    ).toBe(false);
  });

  test("prefers explicit task id over session-derived task id", () => {
    const session = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "session-1",
      taskId: "task-from-session",
    });

    expect(
      resolveAgentStudioTaskId({
        taskIdParam: "task-from-url",
        selectedSessionById: session,
      }),
    ).toBe("task-from-url");
    expect(
      resolveAgentStudioTaskId({
        taskIdParam: "",
        selectedSessionById: session,
      }),
    ).toBe("task-from-session");
  });

  test("resolves default role for open tasks from first required available workflow", () => {
    const task = createTaskCardFixture({
      id: "task-1",
      status: "open",
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: true, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    expect(resolveAgentStudioDefaultRoleForTask(task)).toBe("build");
  });

  test("keeps active session unresolved when explicit session param does not belong to active task", () => {
    const plannerSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "planner-1",
      taskId: "task-1",
      role: "planner",
    });
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [plannerSession, buildSession],
      sessionParam: "session-from-other-task",
      hasExplicitRoleParam: true,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved).toBeNull();
  });

  test("falls back by role when no explicit session param is present", () => {
    const plannerSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "planner-1",
      taskId: "task-1",
      role: "planner",
    });
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [plannerSession, buildSession],
      sessionParam: null,
      hasExplicitRoleParam: true,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved?.sessionId).toBe("planner-1");
  });

  test("prioritizes active running session over status defaults", () => {
    const olderBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-older",
      taskId: "task-1",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const runningSpecSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-running",
      taskId: "task-1",
      role: "spec",
      status: "running",
      startedAt: "2026-02-22T09:00:00.000Z",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [olderBuildSession, runningSpecSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved?.sessionId).toBe("spec-running");
  });

  test("chooses the most recent running/starting session when multiple active sessions exist", () => {
    const olderRunningSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "planner-running-older",
      taskId: "task-1",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T09:00:00.000Z",
    });
    const newerStartingSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "qa-starting-newer",
      taskId: "task-1",
      role: "qa",
      status: "starting",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [olderRunningSession, newerStartingSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "human_review" }),
    });

    expect(resolved?.sessionId).toBe("qa-starting-newer");
  });

  test("selects required+available role for open tasks", () => {
    const specSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-1",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [buildSession, specSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectedTask: createTaskCardFixture({
        id: "task-1",
        status: "open",
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: false },
          planner: { required: false, canSkip: true, available: true, completed: false },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: false, canSkip: true, available: false, completed: false },
        },
      }),
    });

    expect(resolved?.sessionId).toBe("spec-1");
  });

  test("returns null for open tasks when no required+available role exists", () => {
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [buildSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({
        id: "task-1",
        status: "open",
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: false, completed: false },
          planner: { required: true, canSkip: false, available: false, completed: false },
          builder: { required: true, canSkip: false, available: false, completed: false },
          qa: { required: false, canSkip: true, available: false, completed: false },
        },
      }),
    });

    expect(resolved).toBeNull();
  });

  test("selects latest spec session for spec_ready tasks", () => {
    const olderSpecSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-older",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T09:00:00.000Z",
    });
    const latestSpecSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-latest",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [olderSpecSession, latestSpecSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "spec_ready" }),
    });

    expect(resolved?.sessionId).toBe("spec-latest");
  });

  test("selects latest planner session for ready_for_dev tasks and falls back to spec", () => {
    const latestSpecSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-latest",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const latestPlannerSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "planner-latest",
      taskId: "task-1",
      role: "planner",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const resolvedWithPlanner = resolveAgentStudioActiveSession({
      sessionsForTask: [latestSpecSession, latestPlannerSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    });

    const resolvedWithFallback = resolveAgentStudioActiveSession({
      sessionsForTask: [latestSpecSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    });

    expect(resolvedWithPlanner?.sessionId).toBe("planner-latest");
    expect(resolvedWithFallback?.sessionId).toBe("spec-latest");
  });

  test("selects latest build session for in_progress, ai_review, and human_review tasks", () => {
    const olderBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-older",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    const latestBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-latest",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const statuses: Array<"in_progress" | "ai_review" | "human_review"> = [
      "in_progress",
      "ai_review",
      "human_review",
    ];

    for (const status of statuses) {
      const resolved = resolveAgentStudioActiveSession({
        sessionsForTask: [olderBuildSession, latestBuildSession],
        sessionParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "spec",
        selectedTask: createTaskCardFixture({ id: "task-1", status }),
      });

      expect(resolved?.sessionId).toBe("build-latest");
    }
  });

  test("selects latest build session for blocked/deferred/closed and falls back to latest overall", () => {
    const latestSpecSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-latest",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T13:00:00.000Z",
    });
    const latestBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-latest",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const statuses: Array<"blocked" | "deferred" | "closed"> = ["blocked", "deferred", "closed"];

    for (const status of statuses) {
      const resolvedWithBuild = resolveAgentStudioActiveSession({
        sessionsForTask: [latestSpecSession, latestBuildSession],
        sessionParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "qa",
        selectedTask: createTaskCardFixture({ id: "task-1", status }),
      });

      const resolvedFallback = resolveAgentStudioActiveSession({
        sessionsForTask: [latestSpecSession],
        sessionParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "qa",
        selectedTask: createTaskCardFixture({ id: "task-1", status }),
      });

      expect(resolvedWithBuild?.sessionId).toBe("build-latest");
      expect(resolvedFallback?.sessionId).toBe("spec-latest");
    }
  });

  test("returns null when no selected task is available", () => {
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioActiveSession({
      sessionsForTask: [buildSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: null,
    });

    expect(resolved).toBeNull();
  });

  test("resolves role from workflow default even when no session exists", () => {
    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "human_review" }),
      fallbackRole: "spec",
    });

    expect(selection.activeSession).toBeNull();
    expect(selection.role).toBe("build");
    expect(selection.scenario).toBe("build_implementation_start");
  });

  test("keeps explicit session authority over task-status defaults", () => {
    const qaSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "qa-1",
      taskId: "task-1",
      role: "qa",
      scenario: "qa_review",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [qaSession],
      sessionParam: "qa-1",
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "human_review" }),
      fallbackRole: "build",
    });

    expect(selection.activeSession?.sessionId).toBe("qa-1");
    expect(selection.role).toBe("qa");
    expect(selection.scenario).toBe("qa_review");
  });

  test("prioritizes explicit scenario for explicit role selection", () => {
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [buildSession],
      sessionParam: null,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      fallbackRole: "build",
      scenarioFromQuery: "build_after_qa_rejected",
    });

    expect(selection.activeSession?.sessionId).toBe("build-1");
    expect(selection.role).toBe("build");
    expect(selection.scenario).toBe("build_after_qa_rejected");
  });

  test("uses most recent overall session for blocked fallback even with unsorted input", () => {
    const olderSpecSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "spec-older",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T09:00:00.000Z",
    });
    const newerQaSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "qa-newer",
      taskId: "task-1",
      role: "qa",
      startedAt: "2026-02-22T13:00:00.000Z",
    });

    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [olderSpecSession, newerQaSession],
      sessionParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "blocked" }),
      fallbackRole: "spec",
      scenarioFromQuery: null,
    });

    expect(selection.activeSession?.sessionId).toBe("qa-newer");
    expect(selection.role).toBe("qa");
    expect(selection.scenario).toBe("qa_review");
  });

  test("prefers the current build session when resolving conflict reuse", () => {
    const activeBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-active",
      taskId: "task-1",
      role: "build",
    });
    const olderBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-older",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioBuilderSessionForTask({
      taskId: "task-1",
      viewActiveSession: activeBuildSession,
      activeSession: null,
      selectedSessionById: null,
      viewSessionsForTask: [olderBuildSession],
      sessionsForTask: [],
    });

    expect(resolved?.sessionId).toBe("build-active");
  });

  test("falls back to any existing build session for the viewed task", () => {
    const buildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });
    const otherTaskBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-2",
      taskId: "task-2",
      role: "build",
    });

    const resolved = resolveAgentStudioBuilderSessionForTask({
      taskId: "task-1",
      viewActiveSession: null,
      activeSession: otherTaskBuildSession,
      selectedSessionById: null,
      viewSessionsForTask: [],
      sessionsForTask: [buildSession, otherTaskBuildSession],
    });

    expect(resolved?.sessionId).toBe("build-1");
  });

  test("returns a deduplicated ordered list of build sessions for the viewed task", () => {
    const activeBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-active",
      taskId: "task-1",
      role: "build",
    });
    const duplicateBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-active",
      taskId: "task-1",
      role: "build",
    });
    const secondaryBuildSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "build-secondary",
      taskId: "task-1",
      role: "build",
    });

    const sessions = resolveAgentStudioBuilderSessionsForTask({
      taskId: "task-1",
      viewActiveSession: activeBuildSession,
      activeSession: null,
      selectedSessionById: duplicateBuildSession,
      viewSessionsForTask: [secondaryBuildSession],
      sessionsForTask: [activeBuildSession, secondaryBuildSession],
    });

    expect(sessions.map((session) => session.sessionId)).toEqual([
      "build-active",
      "build-secondary",
    ]);
  });
});

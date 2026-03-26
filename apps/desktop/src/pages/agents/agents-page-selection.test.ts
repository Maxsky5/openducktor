import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  coerceVisibleSelectionToCatalog,
  emptyDraftSelections,
  extractCompletionTimestamp,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
  resolveAgentStudioActiveSession,
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
  resolveAgentStudioTaskId,
  toContextStorageKey,
  toRightPanelStorageKey,
  toTabsStorageKey,
} from "./agents-page-selection";

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
    expect(toContextStorageKey("/repo")).toBe("openducktor:agent-studio:context:/repo");
    expect(toTabsStorageKey("/repo")).toBe("openducktor:agent-studio:tabs:/repo");
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

import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createAgentSessionSummaryFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  coerceVisibleSelectionToCatalog,
  emptyDraftSelections,
  extractCompletionTimestamp,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
  resolveAgentStudioBuilderSessionsForTask,
  resolveAgentStudioDefaultRoleForTask,
  resolveAgentStudioSessionSelection,
  toContextStorageKey,
  toRightPanelStorageKey,
  toTabsStorageKey,
} from "./agents-page-selection";

const resolveAgentStudioSelectedSessionSummary = (args: {
  sessionsForTask: Parameters<typeof resolveAgentStudioSessionSelection>[0]["sessionsForTask"];
  sessionExternalId: Parameters<typeof resolveAgentStudioSessionSelection>[0]["sessionExternalId"];
  hasExplicitRoleParam: boolean;
  roleFromQuery: Parameters<typeof resolveAgentStudioSessionSelection>[0]["roleFromQuery"];
  selectedTask: Parameters<typeof resolveAgentStudioSessionSelection>[0]["selectedTask"];
}) => {
  return resolveAgentStudioSessionSelection({
    ...args,
    sessionlessRole: args.roleFromQuery,
  }).sessionSummary;
};

const catalogFixture: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
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
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
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
    const plannerSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "planner-1",
      taskId: "task-1",
      role: "planner",
    });
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [plannerSession, buildSession],
      sessionExternalId: "session-from-other-task",
      hasExplicitRoleParam: true,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved).toBeNull();
  });

  test("falls back by role when no explicit session param is present", () => {
    const plannerSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "planner-1",
      taskId: "task-1",
      role: "planner",
    });
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [plannerSession, buildSession],
      sessionExternalId: null,
      hasExplicitRoleParam: true,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved?.externalSessionId).toBe("planner-1");
  });

  test("keeps explicit role selection sessionless when requested", () => {
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioSessionSelection({
      sessionsForTask: [buildSession],
      sessionExternalId: null,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      sessionlessRole: "build",
      keepExplicitRoleSessionless: true,
    });

    expect(resolved).toEqual({ sessionSummary: null, role: "build" });
  });

  test("prioritizes active running session over status defaults", () => {
    const olderBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-older",
      taskId: "task-1",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const runningSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-running",
      taskId: "task-1",
      role: "spec",
      status: "running",
      startedAt: "2026-02-22T09:00:00.000Z",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [olderBuildSession, runningSpecSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved?.externalSessionId).toBe("spec-running");
  });

  test("prioritizes waiting-input session over status defaults even when idle", () => {
    const olderBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-older",
      taskId: "task-1",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const waitingSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-waiting",
      taskId: "task-1",
      role: "spec",
      status: "idle",
      startedAt: "2026-02-22T09:00:00.000Z",
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [
            {
              header: "Decision",
              question: "Which path should the agent take?",
              options: [{ label: "Continue", description: "Continue the session" }],
            },
          ],
        },
      ],
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [olderBuildSession, waitingSpecSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
    });

    expect(resolved?.externalSessionId).toBe("spec-waiting");
  });

  test("chooses the most recent running/starting session when multiple active sessions exist", () => {
    const olderRunningSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "planner-running-older",
      taskId: "task-1",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T09:00:00.000Z",
    });
    const newerStartingSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "qa-starting-newer",
      taskId: "task-1",
      role: "qa",
      status: "starting",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [olderRunningSession, newerStartingSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "human_review" }),
    });

    expect(resolved?.externalSessionId).toBe("qa-starting-newer");
  });

  test("selects required+available role for open tasks", () => {
    const specSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-1",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [buildSession, specSession],
      sessionExternalId: null,
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

    expect(resolved?.externalSessionId).toBe("spec-1");
  });

  test("returns null for open tasks when no required+available role exists", () => {
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [buildSession],
      sessionExternalId: null,
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
    const olderSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-older",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T09:00:00.000Z",
    });
    const latestSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-latest",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [olderSpecSession, latestSpecSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "spec_ready" }),
    });

    expect(resolved?.externalSessionId).toBe("spec-latest");
  });

  test("selects latest planner session for ready_for_dev tasks and falls back to spec", () => {
    const latestSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-latest",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const latestPlannerSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "planner-latest",
      taskId: "task-1",
      role: "planner",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const resolvedWithPlanner = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [latestSpecSession, latestPlannerSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    });

    const resolvedWithFallback = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [latestSpecSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    });

    expect(resolvedWithPlanner?.externalSessionId).toBe("planner-latest");
    expect(resolvedWithFallback?.externalSessionId).toBe("spec-latest");
  });

  test("selects latest build session for in_progress, ai_review, and human_review tasks", () => {
    const olderBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-older",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    const latestBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-latest",
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
      const resolved = resolveAgentStudioSelectedSessionSummary({
        sessionsForTask: [olderBuildSession, latestBuildSession],
        sessionExternalId: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "spec",
        selectedTask: createTaskCardFixture({ id: "task-1", status }),
      });

      expect(resolved?.externalSessionId).toBe("build-latest");
    }
  });

  test("selects latest build session for blocked/closed and falls back to latest overall", () => {
    const latestSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-latest",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T13:00:00.000Z",
    });
    const latestBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-latest",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const statuses: Array<"blocked" | "closed"> = ["blocked", "closed"];

    for (const status of statuses) {
      const resolvedWithBuild = resolveAgentStudioSelectedSessionSummary({
        sessionsForTask: [latestSpecSession, latestBuildSession],
        sessionExternalId: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "qa",
        selectedTask: createTaskCardFixture({ id: "task-1", status }),
      });

      const resolvedFallback = resolveAgentStudioSelectedSessionSummary({
        sessionsForTask: [latestSpecSession],
        sessionExternalId: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "qa",
        selectedTask: createTaskCardFixture({ id: "task-1", status }),
      });

      expect(resolvedWithBuild?.externalSessionId).toBe("build-latest");
      expect(resolvedFallback?.externalSessionId).toBe("spec-latest");
    }
  });

  test("returns null when no selected task is available", () => {
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioSelectedSessionSummary({
      sessionsForTask: [buildSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: null,
    });

    expect(resolved).toBeNull();
  });

  test("resolves role from workflow default even when no session exists", () => {
    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "human_review" }),
      sessionlessRole: "spec",
    });

    expect(selection.sessionSummary).toBeNull();
    expect(selection.role).toBe("build");
  });

  test("keeps explicit session authority over task-status defaults", () => {
    const qaSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "qa-1",
      taskId: "task-1",
      role: "qa",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [qaSession],
      sessionExternalId: qaSession.externalSessionId,
      hasExplicitRoleParam: false,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "human_review" }),
      sessionlessRole: "build",
    });

    expect(selection.sessionSummary?.externalSessionId).toBe("qa-1");
    expect(selection.role).toBe("qa");
  });

  test("prioritizes explicit launch action for explicit role selection", () => {
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [buildSession],
      sessionExternalId: null,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      sessionlessRole: "build",
    });

    expect(selection.sessionSummary?.externalSessionId).toBe("build-1");
    expect(selection.role).toBe("build");
  });

  test("uses most recent overall session for blocked fallback even with unsorted input", () => {
    const olderSpecSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "spec-older",
      taskId: "task-1",
      role: "spec",
      startedAt: "2026-02-22T09:00:00.000Z",
    });
    const newerQaSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "qa-newer",
      taskId: "task-1",
      role: "qa",
      startedAt: "2026-02-22T13:00:00.000Z",
    });

    const selection = resolveAgentStudioSessionSelection({
      sessionsForTask: [olderSpecSession, newerQaSession],
      sessionExternalId: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "blocked" }),
      sessionlessRole: "spec",
    });

    expect(selection.sessionSummary?.externalSessionId).toBe("qa-newer");
    expect(selection.role).toBe("qa");
  });

  test("prefers the current build session when resolving conflict reuse", () => {
    const activeBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-active",
      taskId: "task-1",
      role: "build",
    });
    const olderBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-older",
      taskId: "task-1",
      role: "build",
    });

    const resolved = resolveAgentStudioBuilderSessionsForTask({
      taskId: "task-1",
      candidateSessions: [activeBuildSession, null, null, olderBuildSession],
    })[0];

    expect(resolved?.externalSessionId).toBe("build-active");
  });

  test("falls back to any existing build session for the viewed task", () => {
    const buildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-1",
      taskId: "task-1",
      role: "build",
    });
    const otherTaskBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-2",
      taskId: "task-2",
      role: "build",
    });

    const resolved = resolveAgentStudioBuilderSessionsForTask({
      taskId: "task-1",
      candidateSessions: [null, otherTaskBuildSession, null, buildSession, otherTaskBuildSession],
    })[0];

    expect(resolved?.externalSessionId).toBe("build-1");
  });

  test("returns a deduplicated ordered list of build sessions for the viewed task", () => {
    const activeBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-active",
      taskId: "task-1",
      role: "build",
    });
    const secondaryBuildSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "build-secondary",
      taskId: "task-1",
      role: "build",
    });

    const sessions = resolveAgentStudioBuilderSessionsForTask({
      taskId: "task-1",
      candidateSessions: [
        activeBuildSession,
        null,
        activeBuildSession,
        secondaryBuildSession,
        activeBuildSession,
        secondaryBuildSession,
      ],
    });

    expect(sessions.map((session) => session.externalSessionId)).toEqual([
      "build-active",
      "build-secondary",
    ]);
  });
});

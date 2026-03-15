import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  emptyDraftSelections,
  extractCompletionTimestamp,
  isSameSelection,
  normalizeSelectionForCatalog,
  pickDefaultSelectionForCatalog,
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
    expect(pickDefaultSelectionForCatalog(catalogFixture)).toEqual({
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

    expect(pickDefaultSelectionForCatalog(providerCollisionCatalog)).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "shared-model",
      variant: "balanced",
    });
  });

  test("normalizes variant and removes unsupported agent", () => {
    expect(
      normalizeSelectionForCatalog(catalogFixture, {
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
      normalizeSelectionForCatalog(catalogFixture, {
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
    });

    expect(resolved?.sessionId).toBe("planner-1");
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

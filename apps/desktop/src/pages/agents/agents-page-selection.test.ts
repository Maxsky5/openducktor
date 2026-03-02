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
  agents: [
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec",
    });
  });

  test("normalizes variant and removes unsupported agent", () => {
    expect(
      normalizeSelectionForCatalog(catalogFixture, {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "not-supported",
        opencodeAgent: "hidden-subagent",
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      normalizeSelectionForCatalog(catalogFixture, {
        providerId: "unknown",
        modelId: "missing",
      }),
    ).toBeNull();
  });

  test("compares selections by full tuple", () => {
    expect(isSameSelection(null, null)).toBe(true);
    expect(
      isSameSelection(
        { providerId: "openai", modelId: "gpt-5", variant: "default", opencodeAgent: "spec" },
        { providerId: "openai", modelId: "gpt-5", variant: "default", opencodeAgent: "spec" },
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
      sessionId: "planner-1",
      taskId: "task-1",
      role: "planner",
    });
    const buildSession = createAgentSessionFixture({
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
      sessionId: "planner-1",
      taskId: "task-1",
      role: "planner",
    });
    const buildSession = createAgentSessionFixture({
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
});

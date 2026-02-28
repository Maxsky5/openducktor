import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioSelectionQueryUpdate,
  buildAutoStartKey,
  buildCreateSessionStartKey,
  buildFreshStartQueryUpdate,
  buildPreviousSelectionQueryUpdate,
  resolveReusableSessionForStart,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

describe("use-agent-studio-session-action-helpers", () => {
  test("resolveReusableSessionForStart prefers active session when fresh is not requested", () => {
    const activeSession = createAgentSessionFixture({
      sessionId: "session-active",
      role: "spec",
      scenario: "spec_initial",
    });

    const decision = resolveReusableSessionForStart({
      activeSession,
      sessionStartPreference: null,
      sessionsForTask: [],
      role: "spec",
    });

    expect(decision).toEqual({
      session: activeSession,
      clearStart: true,
    });
  });

  test("resolveReusableSessionForStart uses latest role session for continue preference", () => {
    const plannerSession = createAgentSessionFixture({
      sessionId: "session-plan",
      role: "planner",
      scenario: "planner_initial",
    });

    const decision = resolveReusableSessionForStart({
      activeSession: null,
      sessionStartPreference: "continue",
      sessionsForTask: [plannerSession],
      role: "planner",
    });

    expect(decision).toEqual({
      session: plannerSession,
      clearStart: false,
    });
  });

  test("buildAgentStudioSelectionQueryUpdate clears autostart and optionally clears start", () => {
    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        sessionId: "session-1",
        role: "spec",
        scenario: "spec_initial",
      }),
    ).toEqual({
      task: "task-1",
      session: "session-1",
      agent: "spec",
      scenario: "spec_initial",
      autostart: undefined,
    });

    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        sessionId: "session-2",
        role: "planner",
        scenario: "planner_initial",
        clearStart: true,
      }),
    ).toEqual({
      task: "task-1",
      session: "session-2",
      agent: "planner",
      scenario: "planner_initial",
      autostart: undefined,
      start: undefined,
    });
  });

  test("applyAgentStudioSelectionQuery forwards normalized update shape", () => {
    const updates: Array<Record<string, string | undefined>> = [];

    applyAgentStudioSelectionQuery(
      (entry) => {
        updates.push(entry);
      },
      {
        taskId: "task-1",
        sessionId: "session-1",
        role: "build",
        scenario: "build_implementation_start",
      },
    );

    expect(updates).toEqual([
      {
        task: "task-1",
        session: "session-1",
        agent: "build",
        scenario: "build_implementation_start",
        autostart: undefined,
      },
    ]);
  });

  test("buildFreshStartQueryUpdate and buildPreviousSelectionQueryUpdate keep query contracts", () => {
    const activeSession = createAgentSessionFixture({
      taskId: "task-existing",
      sessionId: "session-existing",
      role: "build",
      scenario: "build_implementation_start",
    });

    expect(
      buildFreshStartQueryUpdate({
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
      }),
    ).toEqual({
      task: "task-1",
      session: undefined,
      agent: "planner",
      scenario: "planner_initial",
      autostart: undefined,
      start: "fresh",
    });

    expect(
      buildPreviousSelectionQueryUpdate({
        activeSession,
        taskId: "task-fallback",
        role: "spec",
        scenario: "spec_initial",
      }),
    ).toEqual({
      task: "task-existing",
      session: "session-existing",
      agent: "spec",
      scenario: "spec_initial",
      autostart: undefined,
      start: undefined,
    });
  });

  test("buildCreateSessionStartKey, buildAutoStartKey and shouldTriggerContextSwitchIntent", () => {
    expect(
      buildCreateSessionStartKey({
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
      }),
    ).toBe("task-1:qa:qa_review");

    expect(
      buildAutoStartKey({
        activeRepo: "/repo",
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
      }),
    ).toBe("/repo:task-1:spec:spec_initial");

    expect(
      buildAutoStartKey({
        activeRepo: null,
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
      }),
    ).toBeNull();

    expect(
      shouldTriggerContextSwitchIntent({
        currentSessionId: "session-1",
        currentRole: "spec",
        nextSessionId: "session-1",
        nextRole: "spec",
      }),
    ).toBe(false);

    expect(
      shouldTriggerContextSwitchIntent({
        currentSessionId: "session-1",
        currentRole: "spec",
        nextSessionId: "session-2",
        nextRole: "spec",
      }),
    ).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioSelectionQueryUpdate,
  buildCreateSessionStartKey,
  buildPreviousSelectionQueryUpdate,
  resolveReusableSessionForStart,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

describe("use-agent-studio-session-action-helpers", () => {
  test("resolveReusableSessionForStart returns active session when present", () => {
    const activeSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "session-active",
      role: "spec",
      scenario: "spec_initial",
    });

    const decision = resolveReusableSessionForStart({
      activeSession,
      sessionsForTask: [],
      role: "spec",
    });

    expect(decision).toEqual({
      session: activeSession,
    });
  });

  test("resolveReusableSessionForStart returns null when no active session", () => {
    const decision = resolveReusableSessionForStart({
      activeSession: null,
      sessionsForTask: [],
      role: "planner",
    });

    expect(decision).toBeNull();
  });

  test("buildAgentStudioSelectionQueryUpdate clears autostart and start", () => {
    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        sessionId: "session-1",
        role: "spec",
      }),
    ).toEqual({
      task: "task-1",
      session: "session-1",
      agent: "spec",
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
      },
    );

    expect(updates).toEqual([
      {
        task: "task-1",
        session: "session-1",
        agent: "build",
        autostart: undefined,
        start: undefined,
      },
    ]);
  });

  test("buildPreviousSelectionQueryUpdate keeps query contracts", () => {
    const activeSession = createAgentSessionFixture({
      taskId: "task-existing",
      sessionId: "session-existing",
      role: "build",
      scenario: "build_implementation_start",
    });

    expect(
      buildPreviousSelectionQueryUpdate({
        activeSession,
        taskId: "task-fallback",
        role: "spec",
      }),
    ).toEqual({
      task: "task-existing",
      session: "session-existing",
      agent: "spec",
      scenario: "build_implementation_start",
      autostart: undefined,
      start: undefined,
    });
  });

  test("buildCreateSessionStartKey and shouldTriggerContextSwitchIntent", () => {
    expect(
      buildCreateSessionStartKey({
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
      }),
    ).toBe("task-1:qa:qa_review");

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

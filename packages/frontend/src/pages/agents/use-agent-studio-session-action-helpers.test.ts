import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioSelectionQueryUpdate,
  buildCreateSessionStartKey,
  buildPreviousSelectionQueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

describe("use-agent-studio-session-action-helpers", () => {
  test("buildAgentStudioSelectionQueryUpdate selects the requested session", () => {
    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        externalSessionId: "session-1",
        role: "spec",
      }),
    ).toEqual({
      task: "task-1",
      session: "session-1",
      agent: "spec",
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
        externalSessionId: "session-1",
        role: "build",
      },
    );

    expect(updates).toEqual([
      {
        task: "task-1",
        session: "session-1",
        agent: "build",
      },
    ]);
  });

  test("buildPreviousSelectionQueryUpdate keeps query contracts", () => {
    const activeSession = createAgentSessionFixture({
      taskId: "task-existing",
      externalSessionId: "session-existing",
      role: "build",
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
    });
  });

  test("buildCreateSessionStartKey and shouldTriggerContextSwitchIntent", () => {
    expect(
      buildCreateSessionStartKey({
        taskId: "task-1",
        role: "qa",
        launchActionId: "qa_review",
      }),
    ).toBe("task-1:qa:qa_review");

    expect(
      shouldTriggerContextSwitchIntent({
        currentExternalSessionId: "session-1",
        currentRole: "spec",
        nextSessionId: "session-1",
        nextRole: "spec",
      }),
    ).toBe(false);

    expect(
      shouldTriggerContextSwitchIntent({
        currentExternalSessionId: "session-1",
        currentRole: "spec",
        nextSessionId: "session-2",
        nextRole: "spec",
      }),
    ).toBe(true);
  });
});

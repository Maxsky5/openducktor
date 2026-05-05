import { describe, expect, test } from "bun:test";
import { isSelectionIntentResolved } from "./agent-studio-selection-intent";

describe("agent-studio-selection-intent", () => {
  test("resolves a sessionless role intent when the query has no concrete session", () => {
    expect(
      isSelectionIntentResolved({
        selectionIntent: {
          taskId: "task-1",
          externalSessionId: null,
          role: "build",
        },
        taskIdParam: "task-1",
        sessionParam: null,
        roleFromQuery: "build",
      }),
    ).toBe(true);

    expect(
      isSelectionIntentResolved({
        selectionIntent: {
          taskId: "task-1",
          externalSessionId: null,
          role: "build",
        },
        taskIdParam: "task-1",
        sessionParam: "session-1",
        roleFromQuery: "build",
      }),
    ).toBe(false);
  });

  test("resolves a session intent only when task, role, and session match", () => {
    const selectionIntent = {
      taskId: "task-1",
      externalSessionId: "session-1",
      role: "planner" as const,
    };

    expect(
      isSelectionIntentResolved({
        selectionIntent,
        taskIdParam: "task-1",
        sessionParam: "session-1",
        roleFromQuery: "planner",
      }),
    ).toBe(true);
    expect(
      isSelectionIntentResolved({
        selectionIntent,
        taskIdParam: "task-1",
        sessionParam: null,
        roleFromQuery: "planner",
      }),
    ).toBe(false);
    expect(
      isSelectionIntentResolved({
        selectionIntent,
        taskIdParam: "task-1",
        sessionParam: "session-1",
        roleFromQuery: "build",
      }),
    ).toBe(false);
  });
});

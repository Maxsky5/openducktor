import { describe, expect, test } from "bun:test";
import { restoreNavigationFromPersistedContext } from "./agent-studio-navigation";

describe("agent-studio-navigation", () => {
  test("does not restore a stale persisted session over an explicit task", () => {
    expect(
      restoreNavigationFromPersistedContext(
        {
          taskId: "task-current",
          externalSessionId: null,
          role: null,
        },
        {
          taskId: "task-persisted",
          externalSessionId: "session-persisted",
          role: "planner",
        },
      ),
    ).toEqual({
      taskId: "task-current",
      externalSessionId: null,
      role: "planner",
    });
  });

  test("restores the persisted session when the explicit task matches", () => {
    expect(
      restoreNavigationFromPersistedContext(
        {
          taskId: "task-current",
          externalSessionId: null,
          role: null,
        },
        {
          taskId: "task-current",
          externalSessionId: "session-persisted",
          role: "planner",
        },
      ),
    ).toEqual({
      taskId: "task-current",
      externalSessionId: "session-persisted",
      role: "planner",
    });
  });
});

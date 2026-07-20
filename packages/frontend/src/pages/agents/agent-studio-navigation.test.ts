import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  buildAgentStudioSelectionQueryUpdate,
  buildSearchParamsFromNavigationState,
  parseNavigationStateFromSearchParams,
  parsePersistedContext,
  restoreNavigationFromPersistedContext,
  serializePersistedContext,
} from "./query-sync/agent-studio-navigation";

describe("agent-studio-navigation", () => {
  test("buildAgentStudioSelectionQueryUpdate selects the requested session", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-1",
    });

    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        session,
        role: "spec",
      }),
    ).toEqual({
      task: "task-1",
      session: "session-1",
      agent: "spec",
    });
  });

  test("round trips a plain external session id through the Agent Studio URL", () => {
    const navigation = parseNavigationStateFromSearchParams(
      new URLSearchParams("task=task-1&session=session-1&agent=build"),
    );

    expect(navigation).toEqual({
      taskId: "task-1",
      sessionExternalId: "session-1",
      role: "build",
    });
    expect(buildSearchParamsFromNavigationState(new URLSearchParams(), navigation).toString()).toBe(
      "task=task-1&session=session-1&agent=build",
    );
  });

  test("persists only the external session id for workspace navigation", () => {
    const serialized = serializePersistedContext({
      taskId: "task-1",
      sessionExternalId: "session-1",
      role: "build",
    });

    expect(JSON.parse(serialized)).toEqual({
      taskId: "task-1",
      sessionExternalId: "session-1",
      role: "build",
    });
    expect(serialized).not.toContain("opencode");
    expect(serialized).not.toContain("/repo/worktrees/session-1");
  });

  test("discards legacy composite session navigation state", () => {
    expect(
      parsePersistedContext(
        JSON.stringify({
          taskId: "task-1",
          role: "build",
          sessionKey: "session-1|opencode|%2Frepo%2Fworktrees%2Fsession-1",
        }),
      ),
    ).toEqual({ taskId: "task-1", role: "build" });
  });

  test("does not restore a stale persisted session over an explicit task", () => {
    expect(
      restoreNavigationFromPersistedContext(
        {
          taskId: "task-current",
          sessionExternalId: null,
          role: null,
        },
        {
          taskId: "task-persisted",
          sessionExternalId: "session-persisted",
          role: "planner",
        },
      ),
    ).toEqual({
      taskId: "task-current",
      sessionExternalId: null,
      role: "planner",
    });
  });

  test("restores the persisted session when the explicit task matches", () => {
    expect(
      restoreNavigationFromPersistedContext(
        {
          taskId: "task-current",
          sessionExternalId: null,
          role: null,
        },
        {
          taskId: "task-current",
          sessionExternalId: "session-persisted",
          role: "planner",
        },
      ),
    ).toEqual({
      taskId: "task-current",
      sessionExternalId: "session-persisted",
      role: "planner",
    });
  });
});

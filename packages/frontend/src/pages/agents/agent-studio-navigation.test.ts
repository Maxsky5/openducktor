import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  buildAgentStudioHref,
  buildAgentStudioSelectionQueryUpdate,
  buildSearchParamsFromNavigationState,
  parseNavigationStateFromSearchParams,
  restoreNavigationFromWorkspaceState,
} from "./query-sync/agent-studio-navigation";

describe("agent-studio-navigation", () => {
  test("builds session and sessionless destinations", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-1",
    });

    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        sessionExternalId: session.externalSessionId,
        role: "spec",
      }),
    ).toEqual({ task: "task-1", session: "session-1", agent: "spec" });
    expect(
      buildAgentStudioHref({
        taskId: "task-1",
        sessionExternalId: session.externalSessionId,
        role: "build",
      }),
    ).toBe("/agents?task=task-1&session=session-1&agent=build");
    expect(buildAgentStudioHref({ taskId: "task-1", sessionExternalId: null, role: "qa" })).toBe(
      "/agents?task=task-1&agent=qa",
    );
  });

  test("round trips an external session id through the URL", () => {
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

  test("restores canonical workspace state when navigation is empty", () => {
    expect(
      restoreNavigationFromWorkspaceState(
        { taskId: "", sessionExternalId: null, role: null },
        {
          openTaskIds: ["task-1"],
          activeTask: {
            taskId: "task-1",
            role: "planner",
            externalSessionId: "session-1",
          },
        },
      ),
    ).toEqual({ taskId: "task-1", sessionExternalId: "session-1", role: "planner" });
  });

  test("keeps URL task and session authority", () => {
    expect(
      restoreNavigationFromWorkspaceState(
        { taskId: "task-url", sessionExternalId: "session-url", role: "qa" },
        {
          openTaskIds: ["task-saved"],
          activeTask: {
            taskId: "task-saved",
            role: "planner",
            externalSessionId: "session-saved",
          },
        },
      ),
    ).toEqual({ taskId: "task-url", sessionExternalId: "session-url", role: "qa" });
  });
});

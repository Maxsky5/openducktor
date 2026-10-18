import { describe, expect, test } from "bun:test";
import {
  applyQueryUpdateToNavigationState,
  buildAgentStudioSelectionQueryUpdate,
  buildSearchParamsFromNavigationState,
  parseNavigationStateFromSearchParams,
  restoreNavigationFromWorkspaceState,
} from "./query-sync/agent-studio-navigation";

describe("agent-studio-navigation", () => {
  test("builds a session selection update with the native ID", () => {
    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        sessionExternalId: "native",
        role: "spec",
      }),
    ).toEqual({
      task: "task-1",
      session: "native",
      agent: "spec",
    });
  });

  test("drops removed fields and keeps notification focus through a URL write", () => {
    const address = new URLSearchParams(
      "workspace=w&kind=task&task=task-1&session=native&agent=build&runtimeKind=codex&workingDirectory=%2Frepo&attention=question&attentionId=request-1",
    );
    const navigation = parseNavigationStateFromSearchParams(address);
    expect(navigation).toEqual({ taskId: "task-1", sessionExternalId: "native", role: "build" });
    expect(buildSearchParamsFromNavigationState(address, navigation).toString()).toBe(
      "workspace=w&kind=task&attention=question&attentionId=request-1&task=task-1&session=native&agent=build",
    );
  });

  test("changes the role without changing the selected session", () => {
    const navigation = parseNavigationStateFromSearchParams(
      new URLSearchParams("task=task-1&session=native&agent=build"),
    );
    expect(applyQueryUpdateToNavigationState(navigation, { agent: "qa" })).toEqual({
      taskId: "task-1",
      sessionExternalId: "native",
      role: "qa",
    });
    expect(applyQueryUpdateToNavigationState(navigation, { session: "other" })).toEqual({
      taskId: "task-1",
      sessionExternalId: "other",
      role: "build",
    });
  });

  test("round trips an external session id without an identity through the URL", () => {
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
    ).toEqual({
      taskId: "task-1",
      sessionExternalId: "session-1",
      role: "planner",
    });
  });

  test("keeps URL task and session authority", () => {
    expect(
      restoreNavigationFromWorkspaceState(
        {
          taskId: "task-url",
          sessionExternalId: "native",
          role: "qa",
        },
        {
          openTaskIds: ["task-saved"],
          activeTask: {
            taskId: "task-saved",
            role: "planner",
            externalSessionId: "session-saved",
          },
        },
      ),
    ).toEqual({
      taskId: "task-url",
      sessionExternalId: "native",
      role: "qa",
    });
  });
});

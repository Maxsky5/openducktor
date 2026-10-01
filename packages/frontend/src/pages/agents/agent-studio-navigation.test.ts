import { describe, expect, test } from "bun:test";
import {
  applyQueryUpdateToNavigationState,
  buildAgentStudioSelectionQueryUpdate,
  buildSearchParamsFromNavigationState,
  parseNavigationStateFromSearchParams,
  restoreNavigationFromWorkspaceState,
} from "./query-sync/agent-studio-navigation";

const codexIdentity = {
  externalSessionId: "native",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktrees/task-1",
} as const;

describe("agent-studio-navigation", () => {
  test("builds a session selection update with the complete identity", () => {
    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        session: codexIdentity,
        role: "spec",
      }),
    ).toEqual({
      task: "task-1",
      session: "native",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktrees/task-1",
      agent: "spec",
    });
  });

  test("keeps the complete session identity through a URL write", () => {
    const address = new URLSearchParams(
      "workspace=w&kind=task&task=task-1&session=native&agent=build&runtimeKind=codex&workingDirectory=%2Frepo%2Fworktrees%2Ftask-1",
    );
    const navigation = parseNavigationStateFromSearchParams(address);

    expect(navigation.sessionIdentity).toEqual(codexIdentity);
    expect(buildSearchParamsFromNavigationState(address, navigation).toString()).toBe(
      "workspace=w&kind=task&task=task-1&session=native&agent=build&runtimeKind=codex&workingDirectory=%2Frepo%2Fworktrees%2Ftask-1",
    );
  });

  test("replaces the session identity with each session update", () => {
    const navigation = parseNavigationStateFromSearchParams(
      new URLSearchParams(
        "task=task-1&session=native&agent=build&runtimeKind=codex&workingDirectory=%2Frepo%2Fworktrees%2Ftask-1",
      ),
    );

    expect(applyQueryUpdateToNavigationState(navigation, { agent: "qa" }).sessionIdentity).toEqual(
      codexIdentity,
    );
    expect(
      applyQueryUpdateToNavigationState(navigation, { session: "other" }).sessionIdentity,
    ).toBeNull();
    expect(
      applyQueryUpdateToNavigationState(navigation, {
        session: "native",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      }).sessionIdentity,
    ).toEqual({ externalSessionId: "native", runtimeKind: "opencode", workingDirectory: "/repo" });
  });

  test("round trips an external session id without an identity through the URL", () => {
    const navigation = parseNavigationStateFromSearchParams(
      new URLSearchParams("task=task-1&session=session-1&agent=build"),
    );

    expect(navigation).toEqual({
      taskId: "task-1",
      sessionExternalId: "session-1",
      sessionIdentity: null,
      role: "build",
    });
    expect(buildSearchParamsFromNavigationState(new URLSearchParams(), navigation).toString()).toBe(
      "task=task-1&session=session-1&agent=build",
    );
  });

  test("restores canonical workspace state when navigation is empty", () => {
    expect(
      restoreNavigationFromWorkspaceState(
        { taskId: "", sessionExternalId: null, sessionIdentity: null, role: null },
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
      sessionIdentity: null,
      role: "planner",
    });
  });

  test("keeps URL task and session authority", () => {
    expect(
      restoreNavigationFromWorkspaceState(
        {
          taskId: "task-url",
          sessionExternalId: "native",
          sessionIdentity: codexIdentity,
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
      sessionIdentity: codexIdentity,
      role: "qa",
    });
  });
});

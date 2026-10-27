import { type BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import { resolveTaskActionDestination, taskActionSendsCommand } from "./task-action-routing";

const builder: SessionTargetOptions = {
  session: { externalSessionId: "b-1", runtimeKind: "opencode", workingDirectory: "/wt/task-1" },
};
const sessions = (role: AgentRole) => (role === "build" ? builder : undefined);

describe("resolveTaskActionDestination", () => {
  test("opens the start sheet for actions that start a session", () => {
    expect(resolveTaskActionDestination("set_spec", "T-1", sessions)).toEqual({
      kind: "start_session",
      action: "set_spec",
    });
    expect(resolveTaskActionDestination("set_plan", "T-1", sessions)).toEqual({
      kind: "start_session",
      action: "set_plan",
    });
    expect(resolveTaskActionDestination("build_start", "T-1", sessions)).toEqual({
      kind: "start_session",
      action: "build_start",
    });
    expect(resolveTaskActionDestination("qa_start", "T-1", sessions)).toEqual({
      kind: "start_session",
      action: "qa_start",
    });
  });

  test("opens the session of a role, or reports that the role has none", () => {
    expect(resolveTaskActionDestination("open_builder", "T-1", sessions)).toEqual({
      kind: "open_session",
      role: "build",
      options: builder,
    });
    expect(resolveTaskActionDestination("open_qa", "T-1", sessions)).toEqual({
      kind: "no_session",
      role: "qa",
    });
  });

  test("routes review and override actions to their sheets and confirmations", () => {
    expect(resolveTaskActionDestination("human_approve", "T-1", sessions)).toEqual({
      kind: "approve",
    });
    expect(resolveTaskActionDestination("human_request_changes", "T-1", sessions)).toEqual({
      kind: "request_changes",
    });
    expect(resolveTaskActionDestination("reset_implementation", "T-1", sessions)).toEqual({
      kind: "confirm",
      action: "reset_implementation",
    });
    expect(resolveTaskActionDestination("reset_task", "T-1", sessions)).toEqual({
      kind: "confirm",
      action: "reset_task",
    });
    expect(resolveTaskActionDestination("close_task", "T-1", sessions)).toEqual({
      kind: "confirm",
      action: "close_task",
    });
  });
});

describe("taskActionSendsCommand", () => {
  test("gates the actions that need the live host and keeps session views open", () => {
    for (const action of [
      "set_spec",
      "set_plan",
      "build_start",
      "qa_start",
      "human_approve",
      "human_request_changes",
      "reset_implementation",
      "reset_task",
      "close_task",
    ] as const) {
      expect(taskActionSendsCommand(action)).toBe(true);
    }
    for (const action of ["open_spec", "open_planner", "open_builder", "open_qa"] as const) {
      expect(taskActionSendsCommand(action)).toBe(false);
    }
  });
});

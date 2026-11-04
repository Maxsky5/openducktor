import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { editBuiltinTaskWorkflow } from "../../test-support/workflow-fixtures";
import { resolveTaskActionDestination, taskActionSendsCommand } from "./task-action-destination";

describe("resolveTaskActionDestination", () => {
  test("starts the task-declared launch", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      availableActions: ["set_spec"],
      issueType: "feature",
    });
    expect(resolveTaskActionDestination(task, "set_spec")).toEqual({
      kind: "launch",
      launchActionId: "spec_initial",
    });
  });

  test("routes an unfamiliar effect action to the existing approval flow", () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      const action = definition.actions.find(({ id }) => id === "human_approve")!;
      definition.actions.push({ ...action, id: "accept_review" });
    });
    const task = {
      ...createTaskCardFixture({
        id: "T-1",
        status: "human_review",
        availableActions: ["accept_review"],
      }),
      taskWorkflow,
    };
    expect(resolveTaskActionDestination(task, "accept_review")).toEqual({
      kind: "approve",
      continuation: undefined,
    });
  });

  test("keeps all Request Changes candidates for selection after commit", () => {
    const launchActionIds = ["build_after_human_request_changes", "after_committed_changes"];
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      const action = definition.actions.find(({ id }) => id === "human_request_changes")!;
      if (action.kind !== "event") throw new Error("Expected a Request Changes event.");
      action.launchActionIds = [...launchActionIds];
      const step = definition.steps.find(
        (step) => step.kind === "agent" && step.roleId === "build",
      )!;
      if (step.kind !== "agent") throw new Error("Expected Builder step.");
      step.launchActions.push({
        ...step.launchActions[0]!,
        id: "after_committed_changes",
        selectWhen: { stateIn: ["in_progress"] },
      });
    });
    const task = {
      ...createTaskCardFixture({
        id: "T-1",
        status: "human_review",
        availableActions: ["human_request_changes"],
      }),
      taskWorkflow,
    };
    expect(resolveTaskActionDestination(task, "human_request_changes")).toEqual({
      kind: "request_changes",
      continuation: { workflow: task.workflow, launchActionIds },
    });
  });

  test("dispatches a declared plain event without treating its ID as a built-in command", () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      definition.events.push({
        id: "inspection.requested",
        from: ["open"],
        guards: [],
        outcomes: [{ to: "ai_review", when: true }],
      });
      definition.actions.push({
        id: "send_for_inspection",
        label: "Inspect",
        kind: "event",
        availableWhen: true,
        eventId: "inspection.requested",
      });
    });
    const task = {
      ...createTaskCardFixture({ id: "T-1", availableActions: ["send_for_inspection"] }),
      taskWorkflow,
    };
    expect(resolveTaskActionDestination(task, "send_for_inspection")).toEqual({
      kind: "event",
      eventId: "inspection.requested",
      launchActionIds: [],
    });
    expect(taskActionSendsCommand(task, "send_for_inspection")).toBe(true);
  });

  test("opens the requested historical session even when its role cannot start", () => {
    const task = createTaskCardFixture({ id: "T-1", status: "closed" });
    const session = {
      externalSessionId: "build-session",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
    };
    expect(
      resolveTaskActionDestination(task, "open_builder", (role) =>
        role === "build" ? { session } : undefined,
      ),
    ).toEqual({ kind: "open_session", role: "build", options: { session } });
    expect(taskActionSendsCommand(task, "open_builder")).toBe(false);
  });

  test("asks for confirmation before a close and rejects an unavailable action", () => {
    const task = createTaskCardFixture({ id: "T-1", availableActions: ["close_task"] });
    expect(resolveTaskActionDestination(task, "close_task")).toEqual({
      kind: "confirm",
      action: "close_task",
      continuation: undefined,
    });
    expect(() => resolveTaskActionDestination(task, "set_spec")).toThrow("unavailable");
  });
});

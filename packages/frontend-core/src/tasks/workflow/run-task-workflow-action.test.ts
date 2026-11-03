import { describe, expect, mock, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { editBuiltinTaskWorkflow } from "../../test-support/workflow-fixtures";
import { runTaskWorkflowAction } from "./run-task-workflow-action";

describe("runTaskWorkflowAction", () => {
  test("starts the task-declared launch", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      availableActions: ["set_spec"],
      issueType: "feature",
    });
    const onLaunch = mock(() => {});
    runTaskWorkflowAction("set_spec", task.id, { onLaunch }, { task });
    expect(onLaunch).toHaveBeenCalledWith(task.id, "spec_initial");
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
    const onHumanApprove = mock(() => {});
    runTaskWorkflowAction("accept_review", task.id, { onHumanApprove }, { task });
    expect(onHumanApprove).toHaveBeenCalledWith(task.id);
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
    const onHumanRequestChanges = mock(() => {});
    runTaskWorkflowAction("human_request_changes", task.id, { onHumanRequestChanges }, { task });
    expect(onHumanRequestChanges).toHaveBeenCalledWith(task.id, {
      workflow: task.workflow,
      launchActionIds,
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
    const onApplyEvent = mock(() => {});
    runTaskWorkflowAction("send_for_inspection", task.id, { onApplyEvent }, { task });
    expect(onApplyEvent).toHaveBeenCalledWith(task.id, "inspection.requested", []);
  });

  test("opens the requested historical session even when its role cannot start", () => {
    const task = createTaskCardFixture({ id: "T-1", status: "closed" });
    const session = {
      externalSessionId: "build-session",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
    };
    const onOpenSession = mock(() => {});
    runTaskWorkflowAction(
      "open_builder",
      task.id,
      { onOpenSession },
      { task, resolveSessionOptions: (role) => (role === "build" ? { session } : undefined) },
    );
    expect(onOpenSession).toHaveBeenCalledWith(task.id, "build", { session });
  });

  test("rejects missing support, unavailable actions, and a different task before dispatch", () => {
    const task = createTaskCardFixture({ id: "T-1", availableActions: ["close_task"] });
    expect(() => runTaskWorkflowAction("close_task", task.id, {}, { task })).toThrow(
      "host capability",
    );
    const onLaunch = mock(() => {});
    expect(() => runTaskWorkflowAction("set_spec", task.id, { onLaunch }, { task })).toThrow(
      "unavailable",
    );
    expect(() => runTaskWorkflowAction("close_task", "T-2", {}, { task })).toThrow(
      "does not match",
    );
    expect(onLaunch).not.toHaveBeenCalled();
  });
});

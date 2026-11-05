import { describe, expect, mock, test } from "bun:test";
import { createTaskCardFixture, toWireTaskCard } from "../../test-support/shared-test-fixtures";
import { editBuiltinTaskWorkflow } from "../../test-support/workflow-fixtures";
import { createTaskActionRunner, type TaskActionRunnerHandlers } from "./task-action-runner";
import { resolveWorkflowBoard } from "@openducktor/workflows";
import {
  createReviewTaskWorkflow,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";

const createHandlers = (): TaskActionRunnerHandlers => ({
  onLaunch: mock(() => {}),
  onApplyEvent: mock(() => {}),
  onOpenTaskDetails: mock(() => {}),
  onOpenSession: mock(() => {}),
  onHumanApprove: mock(() => {}),
  onHumanFeedback: mock(() => {}),
  onConfirm: mock(() => {}),
  continueTaskWorkflow: mock(async () => {}),
  showError: mock(() => {}),
});

describe("createTaskActionRunner", () => {
  test("continues a confirmed implementation reset into its declared launch", async () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      const reset = definition.actions.find(({ id }) => id === "reset_implementation")!;
      if (reset.kind !== "event") throw new Error("Expected the reset event action.");
      reset.launchActionIds = ["build_implementation_start"];
    });
    const task = {
      ...createTaskCardFixture({
        id: "T-1",
        status: "in_progress",
        availableActions: ["reset_implementation"],
      }),
      taskWorkflow,
    };
    const onConfirm = mock<TaskActionRunnerHandlers["onConfirm"]>(() => {});
    const handlers = { ...createHandlers(), onConfirm };
    createTaskActionRunner(handlers)(task, "reset_implementation");

    const [taskId, action, eventId, onCommitted] = onConfirm.mock.calls[0]!;
    expect([taskId, action, eventId]).toEqual([
      "T-1",
      "reset_implementation",
      "reset-implementation",
    ]);
    await onCommitted?.(toWireTaskCard(task));
    expect(handlers.continueTaskWorkflow).toHaveBeenCalledWith(toWireTaskCard(task), {
      workflow: task.workflow,
      launchActionIds: ["build_implementation_start"],
    });
  });

  test("routes a custom worktree reset event to its confirmation and a feedback event to its form", () => {
    const workflow = createReviewTaskWorkflow();
    const board = resolveWorkflowBoard(
      { states: workflow.definition.states.map(({ id }) => ({ id, taskOrder: "updated" })) },
      [workflow],
    );
    const task = createWorkflowTaskCardFixture(workflow, board, { id: "T-1", status: "approval" });
    const handlers = createHandlers();
    const run = createTaskActionRunner(handlers);

    run(task, "drop_review");
    expect(handlers.onConfirm).toHaveBeenCalledWith(
      "T-1",
      "reset_implementation",
      "drop-review",
      undefined,
    );
    run(task, "request_rewrite");
    expect(handlers.onHumanFeedback).toHaveBeenCalledWith("T-1", "request-rewrite", {
      workflow: task.workflow,
      launchActionIds: ["write_feedback"],
    });
    expect(handlers.onApplyEvent).not.toHaveBeenCalled();
    expect(handlers.showError).not.toHaveBeenCalled();
  });

  test("opens the approval of OpenDucktor for an approval action", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      status: "human_review",
      availableActions: ["human_approve"],
    });
    expect(task.taskWorkflow.action("human_approve").kind).toBe("approval");
    const handlers = createHandlers();
    createTaskActionRunner(handlers)(task, "human_approve");
    expect(handlers.onHumanApprove).toHaveBeenCalledWith("T-1");
    expect(handlers.onApplyEvent).not.toHaveBeenCalled();
    expect(handlers.showError).not.toHaveBeenCalled();
  });

  test("lets a surface own its worktree removal", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      status: "closed",
      availableActions: ["remove_worktree"],
    });
    const handlers = createHandlers();
    const onRemoveWorktree = mock(() => {});
    const run = createTaskActionRunner(handlers);

    run(task, "remove_worktree", { onRemoveWorktree });
    expect(onRemoveWorktree).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();

    // Without the surface handler, the task details own the worktree removal.
    run(task, "remove_worktree");
    expect(handlers.onOpenTaskDetails).toHaveBeenCalledWith("T-1");
  });

  test("shows the error of an unavailable action", () => {
    const handlers = createHandlers();
    createTaskActionRunner(handlers)(createTaskCardFixture({ id: "T-1" }), "set_spec");
    expect(handlers.showError).toHaveBeenCalledWith(
      "Workflow action failed",
      expect.stringContaining("unavailable"),
    );
  });
});

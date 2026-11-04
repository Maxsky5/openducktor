import { describe, expect, mock, test } from "bun:test";
import { createTaskCardFixture, toWireTaskCard } from "../../test-support/shared-test-fixtures";
import { editBuiltinTaskWorkflow } from "../../test-support/workflow-fixtures";
import { createTaskActionRunner, type TaskActionRunnerHandlers } from "./task-action-runner";

const createHandlers = (): TaskActionRunnerHandlers => ({
  onLaunch: mock(() => {}),
  onApplyEvent: mock(() => {}),
  onOpenTaskDetails: mock(() => {}),
  onOpenSession: mock(() => {}),
  onHumanApprove: mock(() => {}),
  onHumanRequestChanges: mock(() => {}),
  onConfirm: mock(() => {}),
  continueTaskWorkflow: mock(async () => {}),
  showError: mock(() => {}),
});

describe("createTaskActionRunner", () => {
  test("continues a confirmed close into its declared launch", async () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      const close = definition.actions.find(({ id }) => id === "close_task")!;
      if (close.kind !== "event") throw new Error("Expected the close event action.");
      close.launchActionIds = ["build_implementation_start"];
    });
    const task = {
      ...createTaskCardFixture({ id: "T-1", availableActions: ["close_task"] }),
      taskWorkflow,
    };
    const onConfirm = mock<TaskActionRunnerHandlers["onConfirm"]>(() => {});
    const handlers = { ...createHandlers(), onConfirm };
    createTaskActionRunner(handlers)(task, "close_task");

    const [taskId, action, onCommitted] = onConfirm.mock.calls[0]!;
    expect([taskId, action]).toEqual(["T-1", "close"]);
    await onCommitted?.(toWireTaskCard(task));
    expect(handlers.continueTaskWorkflow).toHaveBeenCalledWith(toWireTaskCard(task), {
      workflow: task.workflow,
      launchActionIds: ["build_implementation_start"],
    });
  });

  test("lets a surface own its confirmations and its worktree removal", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      status: "closed",
      availableActions: ["close_task", "remove_worktree"],
    });
    const handlers = createHandlers();
    const confirm = mock(() => {});
    const onRemoveWorktree = mock(() => {});
    const run = createTaskActionRunner(handlers);

    run(task, "close_task", { confirm, onRemoveWorktree });
    run(task, "remove_worktree", { confirm, onRemoveWorktree });
    expect(confirm).toHaveBeenCalledWith("close", undefined);
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

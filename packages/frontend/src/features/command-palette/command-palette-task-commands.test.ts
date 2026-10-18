import { describe, expect, mock, test } from "bun:test";
import {
  createTaskCardFixture,
  createTaskWorkflowActionsFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import { taskCommandIntent } from "./command-palette-task-commands";
import type { PaletteTaskCommand, PaletteTaskView } from "./command-palette-task-model";
import type { PaletteTask } from "./command-palette-types";

const workspace = createWorkspaceRecordFixture({ workspaceId: "w-1" });
const task: PaletteTask = {
  key: "task:w-1:odt-1",
  workspace,
  task: createTaskCardFixture({ id: "odt-1" }),
};
const builderIdentity = {
  externalSessionId: "build-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
} as const;
const taskView: PaletteTaskView = {
  open: null,
  sessionsNote: null,
  nextStep: null,
  actions: [],
  sessionOptionsByRole: { build: { session: builderIdentity } },
};

/** Run the intent of a command as the runner does in the active workspace of the task. */
const runCommand = (command: Exclude<PaletteTaskCommand, { kind: "copy_id" }>) => {
  const navigate = mock((_href: string) => {});
  const onEdit = mock((_taskId: string) => {});
  const onDelegate = mock((_taskId: string) => {});
  const onOpenSession = mock(() => {});
  const onResetTask = mock(async () => {});
  const onCloseTask = mock(async () => {});
  const onConfirmTaskAction = mock((_taskId: string, _action: string) => {});
  const onOpenTaskDetails = mock((_taskId: string) => {});
  const intent = taskCommandIntent(task, command, taskView);
  intent.run({
    workflow: createTaskWorkflowActionsFixture({
      onEdit,
      onDelegate,
      onOpenSession,
      onResetTask,
      onCloseTask,
      onConfirmTaskAction,
      onOpenTaskDetails,
    }),
    refreshTasks: async () => {},
    navigate,
  });
  return {
    intent,
    navigate,
    onEdit,
    onDelegate,
    onOpenSession,
    onResetTask,
    onCloseTask,
    onConfirmTaskAction,
    onOpenTaskDetails,
  };
};

describe("taskCommandIntent", () => {
  test("runs in the workspace of the task and needs the task in its task list", () => {
    const { intent } = runCommand({ kind: "edit" });

    expect(intent.workspaceId).toBe("w-1");
    expect(intent.taskId).toBe("odt-1");
  });

  test("opens a session by link", () => {
    const session = runCommand({
      kind: "open_session",
      session: { role: "build", identity: builderIdentity },
    });
    expect(session.navigate.mock.calls[0]?.[0]).toContain("session=build-1");
  });

  test("opens the details on the current page", () => {
    const { navigate, onOpenTaskDetails } = runCommand({ kind: "details" });
    expect(onOpenTaskDetails).toHaveBeenCalledWith("odt-1");
    expect(navigate).not.toHaveBeenCalled();
  });

  test("opens the Reset Task and Delete confirmations on the current page", () => {
    for (const kind of ["reset_task", "delete"] as const) {
      const { navigate, onConfirmTaskAction, onResetTask } = runCommand({ kind });
      expect(onConfirmTaskAction).toHaveBeenCalledWith("odt-1", kind);
      expect(navigate).not.toHaveBeenCalled();
      expect(onResetTask).not.toHaveBeenCalled();
    }
  });

  test("runs edit and workflow steps through the workflow handlers", () => {
    expect(runCommand({ kind: "edit" }).onEdit).toHaveBeenCalledWith("odt-1");
    expect(runCommand({ kind: "workflow", action: "build_start" }).onDelegate).toHaveBeenCalledWith(
      "odt-1",
    );
    expect(
      runCommand({ kind: "workflow", action: "open_builder" }).onOpenSession,
    ).toHaveBeenCalledWith("odt-1", "build", { session: builderIdentity });
  });

  test("never runs the Reset Task or Close Task handlers, which do not ask for confirmation", () => {
    expect(
      runCommand({ kind: "workflow", action: "reset_task" }).onResetTask,
    ).not.toHaveBeenCalled();
    expect(
      runCommand({ kind: "workflow", action: "close_task" }).onCloseTask,
    ).not.toHaveBeenCalled();
  });
});

import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import type { PaletteTaskCommand, PaletteTaskView } from "./command-palette-task-model";
import type { PaletteTask } from "./command-palette-types";
import type { WorkspaceIntent } from "./use-workspace-intent-runner";

/**
 * The intent that runs a task command in the workspace of its task, through the handler of that
 * command. The details and the confirmations of Close Task, Reset Task, and Delete task open over
 * the current page.
 */
export const taskCommandIntent = (
  { workspace, task }: PaletteTask,
  command: Exclude<PaletteTaskCommand, { kind: "copy_id" }>,
  taskView: PaletteTaskView,
): WorkspaceIntent => {
  const taskId = task.id;
  const workspaceId = workspace.workspaceId;
  return {
    workspaceId,
    taskId,
    run: ({ workflow, navigate }) => {
      switch (command.kind) {
        case "open_session":
          navigate(
            buildSessionNavigationHref({
              kind: "task_session",
              workspaceId,
              taskId,
              role: command.session.role,
              identity: command.session.identity,
            }),
          );
          return;
        case "workflow":
          workflow.runAction(task, command.action, {
            sessionOptionsOf: (role) => taskView.sessionOptionsByRole[role],
          });
          return;
        case "core":
          workflow.onConfirmTaskAction(taskId, command.action.confirmation);
          return;
        case "edit":
          workflow.onEdit(taskId);
          return;
        case "details":
          workflow.onOpenTaskDetails(taskId);
          return;
        case "delete":
          workflow.onConfirmTaskAction(taskId, command.kind);
          return;
      }
    },
  };
};

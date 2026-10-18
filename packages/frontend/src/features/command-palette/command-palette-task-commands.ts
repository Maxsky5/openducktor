import { buildSessionNavigationHref } from "@/features/session-navigation/session-navigation-target";
import { runTaskWorkflowAction } from "@/features/task-workflow/run-task-workflow-action";
import type { PaletteTaskCommand, PaletteTaskView } from "./command-palette-task-model";
import type { PaletteTask } from "./command-palette-types";
import type { WorkspaceIntent } from "./use-workspace-intent-runner";

/**
 * The intent that runs a task command in the workspace of its task, through the handler of that
 * command. The details and the confirmations of Reset Task and Delete task open over the current
 * page.
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
        case "workflow": {
          // Only actions with their own confirmation or modal. Reset Task and Close Task stay out.
          const {
            onPlan,
            onQaStart,
            onQaOpen,
            onBuild,
            onOpenSession,
            onDelegate,
            onHumanApprove,
            onHumanRequestChanges,
            onResetImplementation,
          } = workflow;
          runTaskWorkflowAction(
            command.action,
            taskId,
            {
              onPlan,
              onQaStart,
              onQaOpen,
              onBuild,
              onOpenSession,
              onDelegate,
              onHumanApprove,
              onHumanRequestChanges,
              onResetImplementation,
            },
            { resolveSessionOptions: (role) => taskView.sessionOptionsByRole[role] },
          );
          return;
        }
        case "edit":
          workflow.onEdit(taskId);
          return;
        case "details":
          workflow.onOpenTaskDetails(taskId);
          return;
        case "reset_task":
        case "delete":
          workflow.onConfirmTaskAction(taskId, command.kind);
          return;
      }
    },
  };
};

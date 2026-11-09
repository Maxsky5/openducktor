import { workflowShortcutActionId } from "@openducktor/contracts";
import type { RefObject } from "react";
import { resolveTaskCardActions, taskActionLabel } from "@openducktor/workflows";
import { coreTaskActions } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import type { TaskDetailsSheetFooterProps } from "./task-details-sheet-footer";

export function useTaskDetailsShortcuts(
  root: RefObject<HTMLElement | null>,
  props: TaskDetailsSheetFooterProps,
): string {
  const {
    task,
    onEdit,
    onDeleteSelect,
    onCoreTaskAction,
    onWorkflowAction,
    onRemoveWorktreeSelect,
  } = props;
  const actions = resolveTaskCardActions(task, {
    surface: "details",
    include: props.includeActions,
    hasActiveSession: props.hasActiveSession ?? false,
    activeSessionRole: props.activeSessionRole,
    historicalSessionRoles: props.historicalSessionRoles,
  });
  const menuAvailable = props.includeActions !== undefined && onWorkflowAction !== undefined;
  return useLocalShortcuts(
    root,
    [
      {
        id: "task-edit" as const,
        run: () => onEdit?.(task.id),
        disabledReason: onEdit ? null : "Task editing is unavailable.",
        localOnly: true,
      },
      {
        id: "task-delete" as const,
        run: () => onDeleteSelect?.(),
        disabledReason: menuAvailable && onDeleteSelect ? null : "Task deletion is unavailable.",
        localOnly: true,
      },
      {
        id: "task-remove-worktree" as const,
        run: () => onRemoveWorktreeSelect?.(),
        disabledReason:
          menuAvailable && onRemoveWorktreeSelect ? null : "This task has no removable worktree.",
        localOnly: true,
      },
      ...(menuAvailable && onCoreTaskAction
        ? coreTaskActions(task).map((action) => ({
            id: action.id === "reset_task" ? ("task-reset" as const) : ("task-close" as const),
            run: () => onCoreTaskAction(action),
            localOnly: true,
          }))
        : []),
      ...(menuAvailable && onWorkflowAction
        ? actions.allActions.map((action) => ({
            id: workflowShortcutActionId(task.taskWorkflow.definition.id, action),
            label: taskActionLabel(action, task),
            run: () => onWorkflowAction(action),
            localOnly: true,
          }))
        : []),
    ],
    '[role="dialog"]',
  );
}

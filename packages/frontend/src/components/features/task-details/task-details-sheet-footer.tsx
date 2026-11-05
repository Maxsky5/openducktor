import {
  type TaskWorkflowAction,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import {
  type CoreTaskAction,
  coreTaskActions,
} from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import { PencilLine, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { coreTaskActionMenuItem } from "@/components/features/kanban/task-action-ui";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { Button } from "@/components/ui/button";

export type TaskDetailsSheetFooterProps = {
  task: TaskCard;
  onOpenChange: (open: boolean) => void;
  onEdit?: (taskId: string) => void;
  includeActions?: readonly TaskWorkflowAction[];
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  historicalSessionRoles?: readonly AgentRole[];
  onWorkflowAction?: (action: TaskWorkflowAction) => void;
  /** Shows Close Task and Reset Task, which OpenDucktor gives every task. */
  onCoreTaskAction?: (action: CoreTaskAction) => void;
  onDeleteSelect?: () => void;
};

const deleteMenuActions = (onDeleteSelect: (() => void) | undefined) =>
  onDeleteSelect
    ? [
        {
          id: "delete-task",
          label: "Delete task",
          icon: <Trash2 className="size-3.5" />,
          variant: "destructiveGhost" as const,
          onSelect: onDeleteSelect,
        },
      ]
    : [];

// The footer maps each host workflow action and session state to one button set.
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function TaskDetailsSheetFooter({
  task,
  onOpenChange,
  onEdit,
  includeActions,
  hasActiveSession = false,
  activeSessionRole,
  historicalSessionRoles,
  onWorkflowAction,
  onCoreTaskAction,
  onDeleteSelect,
}: TaskDetailsSheetFooterProps): ReactElement {
  const extraMenuActions = [
    ...(onCoreTaskAction
      ? coreTaskActions(task).map((action) =>
          coreTaskActionMenuItem(action, () => onCoreTaskAction(action)),
        )
      : []),
    ...deleteMenuActions(onDeleteSelect),
  ];

  return (
    <div className="mt-0 flex flex-none flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {onEdit ? (
          <Button type="button" variant="outline" onClick={() => onEdit(task.id)}>
            <PencilLine className="size-4" />
            Edit
          </Button>
        ) : null}
      </div>

      {includeActions && onWorkflowAction ? (
        <TaskWorkflowActionGroup
          task={task}
          includeActions={includeActions}
          hasActiveSession={hasActiveSession}
          {...(activeSessionRole ? { activeSessionRole } : {})}
          {...(historicalSessionRoles ? { historicalSessionRoles } : {})}
          onAction={onWorkflowAction}
          menuAlign="end"
          className="min-w-[240px] justify-end"
          primaryClassName="font-semibold"
          emptyLabel="No available workflow action"
          hideWhenEmpty
          {...(extraMenuActions.length > 0 ? { extraMenuActions } : {})}
        />
      ) : null}
    </div>
  );
}

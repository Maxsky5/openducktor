import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { PencilLine, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import {
  resolveTaskCardActions,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { Button } from "@/components/ui/button";

type TaskDetailsSheetFooterProps = {
  task: TaskCard;
  onOpenChange: (open: boolean) => void;
  onEdit?: (taskId: string) => void;
  includeActions?: readonly TaskWorkflowAction[];
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  historicalSessionRoles?: readonly AgentRole[];
  onWorkflowAction?: (action: TaskWorkflowAction) => void;
  onDeleteSelect?: () => void;
};

export function TaskDetailsSheetFooter({
  task,
  onOpenChange,
  onEdit,
  includeActions,
  hasActiveSession = false,
  activeSessionRole,
  historicalSessionRoles,
  onWorkflowAction,
  onDeleteSelect,
}: TaskDetailsSheetFooterProps): ReactElement {
  const hasWorkflowAction = Boolean(
    includeActions && onWorkflowAction
      ? resolveTaskCardActions(task, {
          include: includeActions,
          hasActiveSession,
          ...(activeSessionRole ? { activeSessionRole } : {}),
          ...(historicalSessionRoles ? { historicalSessionRoles } : {}),
        }).allActions.length > 0
      : false,
  );
  const extraMenuActions = [
    ...(onDeleteSelect
      ? [
          {
            id: "delete-task",
            label: "Delete task",
            icon: <Trash2 className="size-3.5" />,
            destructive: true,
            onSelect: onDeleteSelect,
          },
        ]
      : []),
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

      {includeActions && onWorkflowAction && (hasWorkflowAction || onDeleteSelect) ? (
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

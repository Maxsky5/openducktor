import type { TaskCard } from "@openducktor/contracts";
import { PencilLine, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { Button } from "@/components/ui/button";

type TaskDetailsSheetFooterProps = {
  task: TaskCard;
  onOpenChange: (open: boolean) => void;
  onEdit?: (taskId: string) => void;
  includeActions: readonly TaskWorkflowAction[];
  onWorkflowAction: (action: TaskWorkflowAction) => void;
  onDeleteSelect?: () => void;
};

export function TaskDetailsSheetFooter({
  task,
  onOpenChange,
  onEdit,
  includeActions,
  onWorkflowAction,
  onDeleteSelect,
}: TaskDetailsSheetFooterProps): ReactElement {
  return (
    <div className="mt-0 flex-none flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
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

      <TaskWorkflowActionGroup
        task={task}
        includeActions={includeActions}
        onAction={onWorkflowAction}
        menuAlign="end"
        className="min-w-[240px] justify-end"
        primaryClassName="font-semibold"
        emptyLabel="No available workflow action"
        {...(onDeleteSelect
          ? {
              extraMenuActions: [
                {
                  id: "delete-task",
                  label: "Delete task",
                  icon: <Trash2 className="size-3.5" />,
                  destructive: true,
                  onSelect: onDeleteSelect,
                },
              ],
            }
          : {})}
      />
    </div>
  );
}

import { RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { TaskConfirmDialog } from "@/components/features/task-details/task-confirm-dialog";
import {
  buildTaskResetImplementationConfirmCopy,
  taskResetImplementationConfirmState,
} from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import type { TaskResetImplementationModalModel } from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";

export function TaskResetImplementationModal({
  model,
}: {
  model: TaskResetImplementationModalModel | null;
}): ReactElement | null {
  if (!model) return null;
  const copy = buildTaskResetImplementationConfirmCopy(model);
  return (
    <TaskConfirmDialog
      open={model.open}
      onOpenChange={(open) => {
        if (!model.isSubmitting) model.onOpenChange(open);
      }}
      onCancel={model.onCancel}
      onConfirm={model.onConfirm}
      copy={copy}
      confirm={taskResetImplementationConfirmState(model, copy)}
      pending={model.isSubmitting}
      error={model.errorMessage}
      icon={RotateCcw}
    />
  );
}

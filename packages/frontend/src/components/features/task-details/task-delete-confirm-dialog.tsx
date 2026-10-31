import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { confirmButtonState } from "@openducktor/frontend-core/tasks/details/task-cleanup-impact-model";
import { buildTaskDeleteConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { TaskConfirmDialog } from "./task-confirm-dialog";
import type { TaskConfirmDialogProps } from "./task-confirm-dialog-types";

export function TaskDeleteConfirmDialog(props: TaskConfirmDialogProps): ReactElement {
  const { task, impact, operation } = props;
  const copy = buildTaskDeleteConfirmCopy(task, impact);
  return (
    <TaskConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
      onCloseAutoFocus={props.onCloseAutoFocus}
      copy={copy}
      confirm={confirmButtonState(impact, operation, copy.confirmLabel)}
      pending={operation.isPending}
      error={operation.error}
      icon={Trash2}
    />
  );
}

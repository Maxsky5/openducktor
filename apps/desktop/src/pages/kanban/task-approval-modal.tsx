import type { ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TaskApprovalModalModel } from "./kanban-page-model-types";
import { getTaskApprovalModalHeader, TaskApprovalModalPanel } from "./task-approval-modal-panel";

export { TaskApprovalModalPanel } from "./task-approval-modal-panel";

export function TaskApprovalModal({
  model,
}: {
  model: TaskApprovalModalModel | null;
}): ReactElement | null {
  if (!model) {
    return null;
  }

  const { title, description } = getTaskApprovalModalHeader(model);

  return (
    <Dialog
      open={model.open}
      onOpenChange={(nextOpen) => {
        if (!model.isSubmitting) {
          model.onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <TaskApprovalModalPanel model={model} />
      </DialogContent>
    </Dialog>
  );
}

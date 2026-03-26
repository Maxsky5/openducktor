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
        <DialogHeader className="space-y-3 border-b border-border/80 px-6 py-6 pr-16 sm:px-8 sm:pr-20">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <TaskApprovalModalPanel model={model} showHeader={false} />
      </DialogContent>
    </Dialog>
  );
}

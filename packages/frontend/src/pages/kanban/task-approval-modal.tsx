import type { ReactElement } from "react";
import { TaskIdentity } from "@/components/features/task-details/task-identity";
import { focusDialogContent } from "@/lib/focus-dialog-content";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TaskApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { getTaskApprovalModalHeader } from "@openducktor/frontend-core/tasks/approval/task-approval-modal-header";
import { TaskApprovalModalPanel } from "./task-approval-modal-panel";

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
      {/*
        A fixed height keeps the modal still while it loads and when the tab or an option changes.
        52rem fits the tallest stage, Direct Merge with a squash message and the cleanup card, so
        only a window lower than that scrolls.
      */}
      <DialogContent
        className="h-[min(52rem,calc(100dvh-2rem))] max-w-3xl overflow-hidden p-0"
        onOpenAutoFocus={focusDialogContent}
      >
        <DialogHeader className="gap-1 border-b border-border/80 px-6 py-4 pr-14 sm:px-8 sm:pr-16">
          <DialogTitle>{title}</DialogTitle>
          {/* The task line describes the dialog, so the stage text is only a note under it. */}
          <DialogDescription asChild>
            <TaskIdentity title={model.taskTitle} taskId={model.taskId} />
          </DialogDescription>
          {description ? <p className="pt-1 text-sm text-muted-foreground">{description}</p> : null}
        </DialogHeader>
        <TaskApprovalModalPanel model={model} />
      </DialogContent>
    </Dialog>
  );
}

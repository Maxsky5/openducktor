import { Loader2, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskConfirmCopyLines } from "@/components/features/task-details/task-confirm-copy-lines";
import {
  buildTaskResetImplementationConfirmCopy,
  taskResetImplementationConfirmState,
} from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import type { TaskResetImplementationModalModel } from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";

type ResetImplementationModalModel = TaskResetImplementationModalModel;

export function TaskResetImplementationModal({
  model,
}: {
  model: ResetImplementationModalModel | null;
}): ReactElement | null {
  if (!model) {
    return null;
  }

  const copy = buildTaskResetImplementationConfirmCopy(model);
  const {
    isBusy,
    disabled: isConfirmBlocked,
    label: confirmLabel,
  } = taskResetImplementationConfirmState(model, copy);

  return (
    <Dialog
      open={model.open}
      onOpenChange={(nextOpen) => {
        if (!model.isSubmitting) {
          model.onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle className="px-6 pt-6 text-xl">{copy.title}</DialogTitle>
          <DialogDescription className="px-6 text-base leading-relaxed text-muted-foreground">
            {copy.descriptionSegments.map((segment) =>
              segment.emphasis ? (
                <span key={segment.text} className="font-medium text-foreground">
                  {segment.text}
                </span>
              ) : (
                segment.text
              ),
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 overflow-y-auto px-6 pb-6">
          <div className="mt-5 space-y-3 rounded-xl border border-destructive-border bg-destructive-surface p-4 text-sm leading-6 text-destructive-surface-foreground">
            <TaskConfirmCopyLines lines={copy.lines} />
            {model.impactError ? (
              <p className="text-destructive-muted">{model.impactError}</p>
            ) : null}
            {model.errorMessage ? (
              <p className="text-destructive-muted">{model.errorMessage}</p>
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter className="mt-0 flex-col-reverse gap-3 border-t border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={model.isSubmitting}
            onClick={model.onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={isConfirmBlocked}
            aria-busy={isBusy}
            onClick={model.onConfirm}
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

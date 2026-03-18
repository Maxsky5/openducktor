import { Loader2, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { KanbanPageModels } from "./kanban-page-model-types";

type ResetImplementationModalModel = KanbanPageModels["resetImplementationModal"];

const formatManagedCleanupMessage = (managedWorktreeCount: number): string => {
  if (managedWorktreeCount > 0) {
    return `${managedWorktreeCount} implementation worktree${managedWorktreeCount === 1 ? "" : "s"} and their related local branch${managedWorktreeCount === 1 ? "" : "es"} will be deleted. Any uncommitted changes in those worktrees will be lost.`;
  }

  return "The implementation worktree and its related local branch will be deleted if they exist. Any uncommitted changes in that worktree will be lost.";
};

export function TaskResetImplementationModal({
  model,
}: {
  model: ResetImplementationModalModel;
}): ReactElement | null {
  if (!model) {
    return null;
  }

  const isBusy = model.isSubmitting || model.isLoadingImpact;
  const confirmLabel = model.isSubmitting
    ? "Resetting implementation..."
    : model.isLoadingImpact
      ? "Checking impact..."
      : "Reset implementation";

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
          <DialogTitle className="px-6 pt-6 text-xl">Reset Implementation</DialogTitle>
          <DialogDescription className="px-6 text-base leading-relaxed text-muted-foreground">
            Reset the current implementation for{" "}
            <span className="font-medium text-foreground">{model.taskTitle}</span>. Builder and QA
            progress for this task will be discarded and the task will move back to{" "}
            <span className="font-medium text-foreground">{model.targetStatusLabel}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="mt-5 space-y-3 rounded-xl border border-destructive-border bg-destructive-surface px-4 py-4 text-sm leading-6 text-destructive-surface-foreground">
            <p className="font-medium">
              This action removes Builder and QA session history for this task.
            </p>
            <p>{formatManagedCleanupMessage(model.managedWorktreeCount)}</p>
            <p>QA reports and linked pull request metadata will be cleared.</p>
            <p>
              Specs and implementation plans are kept. The task status will move back to{" "}
              {model.targetStatusLabel}.
            </p>
            {model.impactError ? (
              <p className="text-destructive-muted">{model.impactError}</p>
            ) : null}
            {model.errorMessage ? (
              <p className="text-destructive-muted">{model.errorMessage}</p>
            ) : null}
          </div>

          <DialogFooter className="mt-6 flex-col-reverse gap-3 border-t border-border px-0 pt-5 sm:flex-row sm:items-center sm:justify-between">
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
              disabled={isBusy}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

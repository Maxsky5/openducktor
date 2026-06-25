import type { TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type UseTaskResetDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  onOpenChange: (open: boolean) => void;
  onResetTask: ((taskId: string) => Promise<void>) | undefined;
};

export function useTaskResetDialog({
  sheetOpen,
  task,
  onOpenChange,
  onResetTask,
}: UseTaskResetDialogOptions): {
  isResetDialogOpen: boolean;
  isResetPending: boolean;
  resetError: string | null;
  openResetDialog: () => void;
  closeResetDialog: () => void;
  handleResetDialogOpenChange: (nextOpen: boolean) => void;
  confirmReset: () => void;
} {
  const canReset = task !== null && onResetTask !== undefined;
  const runReset = useCallback((): Promise<void> => {
    if (task === null || onResetTask === undefined) {
      return Promise.resolve();
    }
    return onResetTask(task.id);
  }, [onResetTask, task]);
  const dialog = useTaskAsyncConfirmDialog({
    sheetOpen,
    scopeKey: task?.id ?? null,
    onOpenChange,
    run: canReset ? runReset : undefined,
  });

  return {
    isResetDialogOpen: dialog.isDialogOpen,
    isResetPending: dialog.isPending,
    resetError: dialog.error,
    openResetDialog: dialog.openDialog,
    closeResetDialog: dialog.closeDialog,
    handleResetDialogOpenChange: dialog.handleDialogOpenChange,
    confirmReset: dialog.confirm,
  };
}

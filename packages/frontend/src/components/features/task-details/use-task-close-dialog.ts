import type { TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type UseTaskCloseDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  onOpenChange: (open: boolean) => void;
  onCloseTask: ((taskId: string) => Promise<void>) | undefined;
};

export function useTaskCloseDialog({
  sheetOpen,
  task,
  onOpenChange,
  onCloseTask,
}: UseTaskCloseDialogOptions): {
  isCloseDialogOpen: boolean;
  isClosePending: boolean;
  closeError: string | null;
  openCloseDialog: () => void;
  closeCloseDialog: () => void;
  handleCloseDialogOpenChange: (nextOpen: boolean) => void;
  confirmClose: () => void;
} {
  const canClose = task !== null && onCloseTask !== undefined;
  const runClose = useCallback((): Promise<void> => {
    if (task === null || onCloseTask === undefined) {
      return Promise.resolve();
    }
    return onCloseTask(task.id);
  }, [onCloseTask, task]);
  const dialog = useTaskAsyncConfirmDialog({
    sheetOpen,
    onOpenChange,
    run: canClose ? runClose : undefined,
  });

  return {
    isCloseDialogOpen: dialog.isDialogOpen,
    isClosePending: dialog.isPending,
    closeError: dialog.error,
    openCloseDialog: dialog.openDialog,
    closeCloseDialog: dialog.closeDialog,
    handleCloseDialogOpenChange: dialog.handleDialogOpenChange,
    confirmClose: dialog.confirm,
  };
}

import type { TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type UseTaskDeleteDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  hasSubtasks: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: ((taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>) | undefined;
};

export function useTaskDeleteDialog({
  sheetOpen,
  task,
  hasSubtasks,
  onOpenChange,
  onDelete,
}: UseTaskDeleteDialogOptions): {
  isDeleteDialogOpen: boolean;
  isDeletePending: boolean;
  deleteError: string | null;
  openDeleteDialog: () => void;
  closeDeleteDialog: () => void;
  handleDeleteDialogOpenChange: (nextOpen: boolean) => void;
  confirmDelete: () => void;
} {
  const canDelete = task !== null && onDelete !== undefined;
  const runDelete = useCallback((): Promise<void> => {
    if (task === null || onDelete === undefined) {
      return Promise.resolve();
    }
    return onDelete(task.id, { deleteSubtasks: hasSubtasks });
  }, [hasSubtasks, onDelete, task]);
  const dialog = useTaskAsyncConfirmDialog({
    sheetOpen,
    onOpenChange,
    run: canDelete ? runDelete : undefined,
  });

  return {
    isDeleteDialogOpen: dialog.isDialogOpen,
    isDeletePending: dialog.isPending,
    deleteError: dialog.error,
    openDeleteDialog: dialog.openDialog,
    closeDeleteDialog: dialog.closeDialog,
    handleDeleteDialogOpenChange: dialog.handleDialogOpenChange,
    confirmDelete: dialog.confirm,
  };
}

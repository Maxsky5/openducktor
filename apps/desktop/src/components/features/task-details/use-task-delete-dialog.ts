import { errorMessage } from "@/lib/errors";
import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteRequestInFlightRef = useRef(false);

  useEffect(() => {
    if (!sheetOpen) {
      setDeleteDialogOpen(false);
      setIsDeleting(false);
      setDeleteError(null);
      deleteRequestInFlightRef.current = false;
    }
  }, [sheetOpen]);

  const openDeleteDialog = useCallback((): void => {
    setDeleteError(null);
    setDeleteDialogOpen(true);
  }, []);

  const closeDeleteDialog = useCallback((): void => {
    if (deleteRequestInFlightRef.current) {
      return;
    }
    setDeleteDialogOpen(false);
    setDeleteError(null);
  }, []);

  const handleDeleteDialogOpenChange = useCallback((nextOpen: boolean): void => {
    if (deleteRequestInFlightRef.current) {
      return;
    }

    setDeleteDialogOpen(nextOpen);
    if (!nextOpen) {
      setDeleteError(null);
    }
  }, []);

  const confirmDelete = useCallback((): void => {
    if (!task || !onDelete || deleteRequestInFlightRef.current) {
      return;
    }

    deleteRequestInFlightRef.current = true;
    setIsDeleting(true);
    setDeleteError(null);

    void onDelete(task.id, { deleteSubtasks: hasSubtasks })
      .then(() => {
        setDeleteDialogOpen(false);
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        setDeleteError(errorMessage(error));
      })
      .finally(() => {
        deleteRequestInFlightRef.current = false;
        setIsDeleting(false);
      });
  }, [hasSubtasks, onDelete, onOpenChange, task]);

  return {
    isDeleteDialogOpen,
    isDeletePending: isDeleting || deleteRequestInFlightRef.current,
    deleteError,
    openDeleteDialog,
    closeDeleteDialog,
    handleDeleteDialogOpenChange,
    confirmDelete,
  };
}

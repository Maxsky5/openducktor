import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";

type UseTaskDeleteDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  hasSubtasks: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: ((taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>) | undefined;
};

type DeleteDialogState = {
  isOpen: boolean;
  isDeleting: boolean;
  error: string | null;
};

type DeleteDialogAction =
  | { type: "sheetClosed" }
  | { type: "opened" }
  | { type: "openChanged"; open: boolean }
  | { type: "deleteStarted" }
  | { type: "deleteSucceeded" }
  | { type: "deleteFailed"; error: string }
  | { type: "deleteFinished" };

const deleteDialogReducer = (
  state: DeleteDialogState,
  action: DeleteDialogAction,
): DeleteDialogState => {
  switch (action.type) {
    case "sheetClosed":
      return { isOpen: false, isDeleting: state.isDeleting, error: null };
    case "opened":
      return { ...state, isOpen: true, error: null };
    case "openChanged":
      return { ...state, isOpen: action.open, error: action.open ? state.error : null };
    case "deleteStarted":
      return { ...state, isDeleting: true, error: null };
    case "deleteSucceeded":
      return { ...state, isOpen: false };
    case "deleteFailed":
      return { ...state, error: action.error };
    case "deleteFinished":
      return { ...state, isDeleting: false };
  }
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
  const [state, dispatch] = useReducer(deleteDialogReducer, {
    isOpen: false,
    isDeleting: false,
    error: null,
  });
  const deleteRequestInFlightRef = useRef(false);

  useEffect(() => {
    if (!sheetOpen) {
      dispatch({ type: "sheetClosed" });
    }
  }, [sheetOpen]);

  const openDeleteDialog = useCallback((): void => {
    dispatch({ type: "opened" });
  }, []);

  const closeDeleteDialog = useCallback((): void => {
    if (deleteRequestInFlightRef.current) {
      return;
    }
    dispatch({ type: "openChanged", open: false });
  }, []);

  const handleDeleteDialogOpenChange = useCallback((nextOpen: boolean): void => {
    if (deleteRequestInFlightRef.current) {
      return;
    }

    dispatch({ type: "openChanged", open: nextOpen });
  }, []);

  const confirmDelete = useCallback((): void => {
    if (!task || !onDelete || deleteRequestInFlightRef.current) {
      return;
    }

    deleteRequestInFlightRef.current = true;
    dispatch({ type: "deleteStarted" });

    void onDelete(task.id, { deleteSubtasks: hasSubtasks })
      .then(() => {
        dispatch({ type: "deleteSucceeded" });
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        dispatch({ type: "deleteFailed", error: errorMessage(error) });
      })
      .finally(() => {
        deleteRequestInFlightRef.current = false;
        dispatch({ type: "deleteFinished" });
      });
  }, [hasSubtasks, onDelete, onOpenChange, task]);

  return {
    isDeleteDialogOpen: state.isOpen,
    isDeletePending: state.isDeleting || deleteRequestInFlightRef.current,
    deleteError: state.error,
    openDeleteDialog,
    closeDeleteDialog,
    handleDeleteDialogOpenChange,
    confirmDelete,
  };
}

import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";

type UseTaskResetDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  onOpenChange: (open: boolean) => void;
  onResetTask: ((taskId: string) => Promise<void>) | undefined;
};

type ResetDialogState = {
  isOpen: boolean;
  isResetting: boolean;
  error: string | null;
};

type ResetDialogAction =
  | { type: "sheetClosed"; keepPending: boolean }
  | { type: "opened" }
  | { type: "openChanged"; open: boolean }
  | { type: "resetStarted" }
  | { type: "resetSucceeded" }
  | { type: "resetFailed"; error: string }
  | { type: "resetFinished" };

const resetDialogReducer = (
  state: ResetDialogState,
  action: ResetDialogAction,
): ResetDialogState => {
  switch (action.type) {
    case "sheetClosed":
      return { isOpen: false, error: null, isResetting: action.keepPending };
    case "opened":
      return { ...state, isOpen: true, error: null };
    case "openChanged":
      return { ...state, isOpen: action.open, error: action.open ? state.error : null };
    case "resetStarted":
      return { ...state, isResetting: true, error: null };
    case "resetSucceeded":
      return { ...state, isOpen: false };
    case "resetFailed":
      return { ...state, error: action.error };
    case "resetFinished":
      return { ...state, isResetting: false };
  }
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
  const [state, dispatch] = useReducer(resetDialogReducer, {
    isOpen: false,
    isResetting: false,
    error: null,
  });
  const resetRequestInFlightRef = useRef(false);

  useEffect(() => {
    if (!sheetOpen) {
      dispatch({ type: "sheetClosed", keepPending: resetRequestInFlightRef.current });
    }
  }, [sheetOpen]);

  const openResetDialog = useCallback((): void => {
    dispatch({ type: "opened" });
  }, []);

  const closeResetDialog = useCallback((): void => {
    if (resetRequestInFlightRef.current) {
      return;
    }
    dispatch({ type: "openChanged", open: false });
  }, []);

  const handleResetDialogOpenChange = useCallback((nextOpen: boolean): void => {
    if (resetRequestInFlightRef.current) {
      return;
    }

    dispatch({ type: "openChanged", open: nextOpen });
  }, []);

  const confirmReset = useCallback((): void => {
    if (!task || !onResetTask || resetRequestInFlightRef.current) {
      return;
    }

    resetRequestInFlightRef.current = true;
    dispatch({ type: "resetStarted" });

    void onResetTask(task.id)
      .then(() => {
        dispatch({ type: "resetSucceeded" });
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        dispatch({ type: "resetFailed", error: errorMessage(error) });
      })
      .finally(() => {
        resetRequestInFlightRef.current = false;
        dispatch({ type: "resetFinished" });
      });
  }, [onOpenChange, onResetTask, task]);

  return {
    isResetDialogOpen: state.isOpen,
    isResetPending: state.isResetting || resetRequestInFlightRef.current,
    resetError: state.error,
    openResetDialog,
    closeResetDialog,
    handleResetDialogOpenChange,
    confirmReset,
  };
}

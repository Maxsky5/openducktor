import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";

type UseTaskCloseDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  onOpenChange: (open: boolean) => void;
  onCloseTask: ((taskId: string) => Promise<void>) | undefined;
};

type CloseDialogState = {
  isOpen: boolean;
  isClosing: boolean;
  error: string | null;
};

type CloseDialogAction =
  | { type: "sheetClosed" }
  | { type: "opened" }
  | { type: "openChanged"; open: boolean }
  | { type: "closeStarted" }
  | { type: "closeSucceeded" }
  | { type: "closeFailed"; error: string }
  | { type: "closeFinished" };

const closeDialogReducer = (
  state: CloseDialogState,
  action: CloseDialogAction,
): CloseDialogState => {
  switch (action.type) {
    case "sheetClosed":
      return { isOpen: false, isClosing: state.isClosing, error: null };
    case "opened":
      return { ...state, isOpen: true, error: null };
    case "openChanged":
      return { ...state, isOpen: action.open, error: action.open ? state.error : null };
    case "closeStarted":
      return { ...state, isClosing: true, error: null };
    case "closeSucceeded":
      return { ...state, isOpen: false };
    case "closeFailed":
      return { ...state, error: action.error };
    case "closeFinished":
      return { ...state, isClosing: false };
  }
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
  const [state, dispatch] = useReducer(closeDialogReducer, {
    isOpen: false,
    isClosing: false,
    error: null,
  });
  const closeRequestInFlightRef = useRef(false);

  if (!sheetOpen && (state.isOpen || state.error !== null)) {
    dispatch({ type: "sheetClosed" });
  }

  const openCloseDialog = useCallback((): void => {
    dispatch({ type: "opened" });
  }, []);

  const closeCloseDialog = useCallback((): void => {
    if (closeRequestInFlightRef.current) {
      return;
    }
    dispatch({ type: "openChanged", open: false });
  }, []);

  const handleCloseDialogOpenChange = useCallback((nextOpen: boolean): void => {
    if (closeRequestInFlightRef.current) {
      return;
    }

    dispatch({ type: "openChanged", open: nextOpen });
  }, []);

  const confirmClose = useCallback((): void => {
    if (!task || !onCloseTask || closeRequestInFlightRef.current) {
      return;
    }

    closeRequestInFlightRef.current = true;
    dispatch({ type: "closeStarted" });

    void onCloseTask(task.id)
      .then(() => {
        dispatch({ type: "closeSucceeded" });
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        dispatch({ type: "closeFailed", error: errorMessage(error) });
      })
      .finally(() => {
        closeRequestInFlightRef.current = false;
        dispatch({ type: "closeFinished" });
      });
  }, [onCloseTask, onOpenChange, task]);

  return {
    isCloseDialogOpen: sheetOpen && state.isOpen,
    isClosePending: state.isClosing || closeRequestInFlightRef.current,
    closeError: state.error,
    openCloseDialog,
    closeCloseDialog,
    handleCloseDialogOpenChange,
    confirmClose,
  };
}

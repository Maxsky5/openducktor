import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { TaskConfirmDialogState } from "./task-confirm-dialog-types";

type AsyncConfirmDialogState = {
  isOpen: boolean;
  isPending: boolean;
  error: string | null;
};

type AsyncConfirmDialogAction =
  | { type: "reset" }
  | { type: "disabled" }
  | { type: "opened" }
  | { type: "openChanged"; open: boolean }
  | { type: "started" }
  | { type: "succeeded" }
  | { type: "failed"; error: string }
  | { type: "finished" };

const asyncConfirmDialogReducer = (
  state: AsyncConfirmDialogState,
  action: AsyncConfirmDialogAction,
): AsyncConfirmDialogState => {
  switch (action.type) {
    case "reset":
      return state.isOpen || state.isPending || state.error !== null
        ? { isOpen: false, isPending: false, error: null }
        : state;
    case "disabled":
      return state.isOpen || state.error !== null
        ? { isOpen: false, isPending: state.isPending, error: null }
        : state;
    case "opened":
      return { ...state, isOpen: true, error: null };
    case "openChanged":
      return { ...state, isOpen: action.open, error: action.open ? state.error : null };
    case "started":
      return { ...state, isPending: true, error: null };
    case "succeeded":
      return { ...state, isOpen: false };
    case "failed":
      return { ...state, error: action.error };
    case "finished":
      return { ...state, isPending: false };
  }
};

type UseTaskAsyncConfirmDialogOptions = {
  /** The dialog can open only while this is true. Turning it off closes the dialog. */
  enabled: boolean;
  /** Open the dialog on mount, for a host that mounts it to ask for one confirmation. */
  initiallyOpen?: boolean;
  /** A new key resets the dialog and ignores the result of a run that started before. */
  scopeKey: string | null;
  run: (() => Promise<void>) | undefined;
  onSucceeded: () => void;
};

export type TaskAsyncConfirmDialog = {
  openDialog: () => void;
  dialog: Omit<TaskConfirmDialogState, "impact">;
};

/** A confirmation that runs an async action and keeps the dialog open with its error on failure. */
export function useTaskAsyncConfirmDialog({
  enabled,
  initiallyOpen = false,
  scopeKey,
  run,
  onSucceeded,
}: UseTaskAsyncConfirmDialogOptions): TaskAsyncConfirmDialog {
  const [state, dispatch] = useReducer(asyncConfirmDialogReducer, {
    isOpen: initiallyOpen,
    isPending: false,
    error: null,
  });
  const requestInFlightRef = useRef(false);
  const previousScopeKeyRef = useRef(scopeKey);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) {
      return;
    }

    previousScopeKeyRef.current = scopeKey;
    requestTokenRef.current += 1;
    requestInFlightRef.current = false;
    dispatch({ type: "reset" });
  }, [scopeKey]);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "disabled" });
    }
  }, [enabled]);

  const openDialog = useCallback((): void => {
    dispatch({ type: "opened" });
  }, []);

  const closeDialog = useCallback((): void => {
    if (requestInFlightRef.current) {
      return;
    }
    dispatch({ type: "openChanged", open: false });
  }, []);

  const handleDialogOpenChange = useCallback((nextOpen: boolean): void => {
    if (requestInFlightRef.current) {
      return;
    }

    dispatch({ type: "openChanged", open: nextOpen });
  }, []);

  const confirm = useCallback((): void => {
    if (!run || requestInFlightRef.current) {
      return;
    }

    const requestToken = requestTokenRef.current;
    requestInFlightRef.current = true;
    dispatch({ type: "started" });

    void run()
      .then(() => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        dispatch({ type: "succeeded" });
        onSucceeded();
      })
      .catch((cause: unknown) => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        dispatch({ type: "failed", error: errorMessage(cause) });
      })
      .finally(() => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        requestInFlightRef.current = false;
        dispatch({ type: "finished" });
      });
  }, [onSucceeded, run]);

  return {
    openDialog,
    dialog: {
      open: enabled && state.isOpen,
      onOpenChange: handleDialogOpenChange,
      onCancel: closeDialog,
      onConfirm: confirm,
      operation: { isPending: state.isPending || requestInFlightRef.current, error: state.error },
    },
  };
}

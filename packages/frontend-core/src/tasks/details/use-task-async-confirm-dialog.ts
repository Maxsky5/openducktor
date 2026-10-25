import { useCallback, useEffect, useReducer, useRef } from "react";
import { isOutcomeUnknown } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import type { TaskConfirmDialogState } from "./task-confirm-dialog-types";

type AsyncConfirmDialogState = {
  isOpen: boolean;
  isPending: boolean;
  error: string | null;
  errorOutcomeUnknown: boolean;
};

type AsyncConfirmDialogAction =
  | { type: "reset" }
  | { type: "disabled" }
  | { type: "opened" }
  | { type: "openChanged"; open: boolean }
  | { type: "started" }
  | { type: "succeeded" }
  | { type: "failed"; error: string; outcomeUnknown: boolean }
  | { type: "finished" };

const CLOSED_STATE: AsyncConfirmDialogState = {
  isOpen: false,
  isPending: false,
  error: null,
  errorOutcomeUnknown: false,
};

const asyncConfirmDialogReducer = (
  state: AsyncConfirmDialogState,
  action: AsyncConfirmDialogAction,
): AsyncConfirmDialogState => {
  switch (action.type) {
    case "reset":
      return state.isOpen || state.isPending || state.error !== null ? CLOSED_STATE : state;
    case "disabled":
      return state.isOpen || state.error !== null
        ? { ...CLOSED_STATE, isPending: state.isPending }
        : state;
    case "opened":
      return { ...state, isOpen: true, error: null, errorOutcomeUnknown: false };
    case "openChanged":
      return action.open
        ? { ...state, isOpen: true }
        : { ...CLOSED_STATE, isPending: state.isPending };
    case "started":
      return { ...state, isPending: true, error: null, errorOutcomeUnknown: false };
    case "succeeded":
      return { ...state, isOpen: false };
    case "failed":
      return { ...state, error: action.error, errorOutcomeUnknown: action.outcomeUnknown };
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
    ...CLOSED_STATE,
    isOpen: initiallyOpen,
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
        dispatch({
          type: "failed",
          error: errorMessage(cause),
          outcomeUnknown: isOutcomeUnknown(cause),
        });
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
      operation: {
        isPending: state.isPending || requestInFlightRef.current,
        error: state.error,
        errorOutcomeUnknown: state.errorOutcomeUnknown,
      },
    },
  };
}

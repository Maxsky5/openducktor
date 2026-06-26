import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";

type AsyncConfirmDialogState = {
  isOpen: boolean;
  isPending: boolean;
  error: string | null;
};

type AsyncConfirmDialogAction =
  | { type: "reset" }
  | { type: "sheetClosed" }
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
    case "sheetClosed":
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
  sheetOpen: boolean;
  scopeKey: string | null;
  onOpenChange: (open: boolean) => void;
  run: (() => Promise<void>) | undefined;
};

export function useTaskAsyncConfirmDialog({
  sheetOpen,
  scopeKey,
  onOpenChange,
  run,
}: UseTaskAsyncConfirmDialogOptions): {
  isDialogOpen: boolean;
  isPending: boolean;
  error: string | null;
  openDialog: () => void;
  closeDialog: () => void;
  handleDialogOpenChange: (nextOpen: boolean) => void;
  confirm: () => void;
} {
  const [state, dispatch] = useReducer(asyncConfirmDialogReducer, {
    isOpen: false,
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
    if (!sheetOpen) {
      dispatch({ type: "sheetClosed" });
    }
  }, [sheetOpen]);

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
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        dispatch({ type: "failed", error: errorMessage(error) });
      })
      .finally(() => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        requestInFlightRef.current = false;
        dispatch({ type: "finished" });
      });
  }, [onOpenChange, run]);

  return {
    isDialogOpen: sheetOpen && state.isOpen,
    isPending: state.isPending || requestInFlightRef.current,
    error: state.error,
    openDialog,
    closeDialog,
    handleDialogOpenChange,
    confirm,
  };
}

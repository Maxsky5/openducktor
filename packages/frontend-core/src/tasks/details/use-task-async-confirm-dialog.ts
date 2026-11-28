import { useCallback, useEffect, useReducer, useRef } from "react";
import { useActiveWorkspaceContext } from "../../app-state/app-state-contexts";
import { useClientConnection } from "../../connection/client-connection-react";
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
  | { type: "refused"; error: string }
  | { type: "finished" };

const CLOSED_STATE: AsyncConfirmDialogState = {
  isOpen: false,
  isPending: false,
  error: null,
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
      return { ...state, isOpen: true, error: null };
    case "openChanged":
      return action.open
        ? { ...state, isOpen: true }
        : { ...CLOSED_STATE, isPending: state.isPending };
    case "started":
      return { ...state, isPending: true, error: null };
    case "succeeded":
      return { ...state, isOpen: false };
    case "refused":
      return { ...state, error: action.error };
    case "finished":
      return { ...state, isPending: false };
  }
};

type UseTaskAsyncConfirmDialogOptions<Result> = {
  /** The dialog can open only while this is true. Turning it off closes the dialog. */
  enabled: boolean;
  /** Open the dialog on mount, for a host that mounts it to ask for one confirmation. */
  initiallyOpen?: boolean;
  /** A new key resets the dialog and ignores the result of a run that started before. */
  scopeKey: string | null;
  run: (() => Promise<Result>) | undefined;
  onSucceeded: () => void;
  /** Gets the result of the committed run, such as the task card that the host returned. */
  onCommitted?: ((result: Result) => Promise<void>) | undefined;
};

export type TaskAsyncConfirmDialog<Result> = {
  openDialog: (onCommitted?: (result: Result) => Promise<void>) => void;
  dialog: Omit<TaskConfirmDialogState, "impact">;
};

/** Keeps the confirmation and its committed continuation tied to the request scope. */
export function useTaskAsyncConfirmDialog<Result>({
  enabled,
  initiallyOpen = false,
  scopeKey,
  run,
  onSucceeded,
  onCommitted,
}: UseTaskAsyncConfirmDialogOptions<Result>): TaskAsyncConfirmDialog<Result> {
  const { backgroundOperations } = useClientConnection();
  const { activeWorkspace } = useActiveWorkspaceContext();
  const requestScope =
    activeWorkspace && scopeKey ? JSON.stringify([activeWorkspace.workspaceId, scopeKey]) : null;
  const [state, dispatch] = useReducer(asyncConfirmDialogReducer, {
    ...CLOSED_STATE,
    isOpen: initiallyOpen,
  });
  const continuationRef = useRef(onCommitted);
  const requestInFlightRef = useRef(false);
  const previousScopeKeyRef = useRef(requestScope);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    if (previousScopeKeyRef.current === requestScope) {
      return;
    }

    previousScopeKeyRef.current = requestScope;
    requestTokenRef.current += 1;
    requestInFlightRef.current = false;
    dispatch({ type: "reset" });
  }, [requestScope]);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "disabled" });
    }
  }, [enabled]);

  const openDialog = useCallback((onCommitted?: (result: Result) => Promise<void>): void => {
    continuationRef.current = onCommitted;
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
    const refusal =
      activeWorkspace && scopeKey
        ? backgroundOperations.admissionError(activeWorkspace, { kind: "task", taskId: scopeKey })
        : "Select the task's workspace before confirming.";
    if (refusal) {
      dispatch({ type: "refused", error: refusal });
      return;
    }

    const requestToken = requestTokenRef.current;
    const continuation = continuationRef.current;
    requestInFlightRef.current = true;
    dispatch({ type: "started" });

    const result = run();
    dispatch({ type: "openChanged", open: false });
    void result
      .then(async (result) => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        await continuation?.(result);
        if (requestToken !== requestTokenRef.current) return;
        dispatch({ type: "succeeded" });
        onSucceeded();
      })
      .catch(() => {})
      .finally(() => {
        if (requestToken !== requestTokenRef.current) {
          return;
        }
        requestInFlightRef.current = false;
        dispatch({ type: "finished" });
      });
  }, [activeWorkspace, backgroundOperations, onSucceeded, run, scopeKey]);

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
        errorOutcomeUnknown: false,
      },
    },
  };
}

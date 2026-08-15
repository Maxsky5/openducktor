import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type {
  TaskExecutionFilePreviewLeavePolicy,
  TaskExecutionSelectedFile,
  TaskExecutionSelectedFilePreviewModel,
} from "@/components/features/agents";
import {
  createTaskExecutionFilePreviewState,
  taskExecutionFilePreviewReducer,
} from "./task-execution-file-preview-state";

export type UseTaskExecutionFilePreviewControllerResult = {
  model: TaskExecutionSelectedFilePreviewModel;
  onSelectFile(file: TaskExecutionSelectedFile): void;
  requestContextTransition(applyTransition: () => void, cancelTransition?: () => void): void;
};

type PendingContextTransition = {
  apply: () => void;
  cancel: (() => void) | null;
};

export const useTaskExecutionFilePreviewController =
  (): UseTaskExecutionFilePreviewControllerResult => {
    const [state, dispatch] = useReducer(
      taskExecutionFilePreviewReducer,
      undefined,
      createTaskExecutionFilePreviewState,
    );
    const stateRef = useRef(state);
    const pendingContextTransitionRef = useRef<PendingContextTransition | null>(null);

    useLayoutEffect(() => {
      stateRef.current = state;
    }, [state]);

    useEffect(() => {
      if (state.pendingIntent?.type !== "leave_context" || state.leavePolicy !== "allow") {
        return;
      }
      const transition = pendingContextTransitionRef.current;
      pendingContextTransitionRef.current = null;
      dispatch({ type: "discard" });
      transition?.apply();
    }, [state.leavePolicy, state.pendingIntent]);

    const onSelectFile = useCallback((file: TaskExecutionSelectedFile) => {
      dispatch({ type: "request", intent: { type: "select", file } });
    }, []);
    const onClose = useCallback(() => {
      dispatch({ type: "request", intent: { type: "close" } });
    }, []);
    const onLeavePolicyChange = useCallback((policy: TaskExecutionFilePreviewLeavePolicy) => {
      dispatch({ type: "report_leave_policy", policy });
    }, []);
    const onKeepEditing = useCallback(() => {
      const transition = pendingContextTransitionRef.current;
      pendingContextTransitionRef.current = null;
      dispatch({ type: "keep_editing" });
      transition?.cancel?.();
    }, []);
    const onDiscard = useCallback(() => {
      const transition =
        stateRef.current.pendingIntent?.type === "leave_context"
          ? pendingContextTransitionRef.current
          : null;
      pendingContextTransitionRef.current = null;
      dispatch({ type: "discard" });
      transition?.apply();
    }, []);
    const requestContextTransition = useCallback(
      (applyTransition: () => void, cancelTransition?: () => void) => {
        const currentState = stateRef.current;
        if (currentState.selectedFile === null) {
          applyTransition();
          return;
        }
        if (currentState.pendingIntent !== null || pendingContextTransitionRef.current !== null) {
          return;
        }
        if (currentState.leavePolicy === "allow") {
          dispatch({ type: "request", intent: { type: "leave_context" } });
          applyTransition();
          return;
        }
        pendingContextTransitionRef.current = {
          apply: applyTransition,
          cancel: cancelTransition ?? null,
        };
        dispatch({ type: "request", intent: { type: "leave_context" } });
      },
      [],
    );
    const model = useMemo<TaskExecutionSelectedFilePreviewModel>(
      () => ({
        selectedFile: state.selectedFile,
        previewSessionKey: state.previewSessionKey,
        preservePreviousSnapshot: state.preservePreviousSnapshot,
        hasPendingDiscard: state.pendingIntent !== null && state.leavePolicy === "confirm",
        onClose,
        onLeavePolicyChange,
        onKeepEditing,
        onDiscard,
      }),
      [onClose, onDiscard, onKeepEditing, onLeavePolicyChange, state],
    );

    return useMemo(
      () => ({ model, onSelectFile, requestContextTransition }),
      [model, onSelectFile, requestContextTransition],
    );
  };

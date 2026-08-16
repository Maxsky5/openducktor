import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type {
  TaskExecutionFilePreviewLeavePolicy,
  TaskExecutionFileSelectionResult,
  TaskExecutionSelectedFile,
  TaskExecutionSelectedFilePreviewModel,
} from "@/components/features/agents";
import {
  createTaskExecutionFilePreviewState,
  taskExecutionFilePreviewReducer,
} from "./task-execution-file-preview-state";

export type UseTaskExecutionFilePreviewControllerResult = {
  model: TaskExecutionSelectedFilePreviewModel;
  onSelectFile(file: TaskExecutionSelectedFile): TaskExecutionFileSelectionResult;
  requestContextTransition(
    applyTransition: () => void,
    cancelTransition?: () => void,
    options?: { force: boolean },
  ): void;
};

type PendingContextTransition = {
  apply: () => void;
  cancel: (() => void) | null;
  force: boolean;
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
      if (state.pendingIntent?.type !== "leave_context" || state.leavePolicy === "defer") {
        return;
      }
      const transition = pendingContextTransitionRef.current;
      if (!transition || (!transition.force && state.leavePolicy !== "allow")) {
        return;
      }
      pendingContextTransitionRef.current = null;
      dispatch({ type: transition.force ? "force_clear" : "discard" });
      transition.apply();
    }, [state.leavePolicy, state.pendingIntent]);

    const onSelectFile = useCallback((file: TaskExecutionSelectedFile) => {
      const currentState = stateRef.current;
      const keepsCurrentSelection =
        currentState.pendingIntent !== null || currentState.leavePolicy !== "allow";
      dispatch({ type: "request", intent: { type: "select", file } });
      return keepsCurrentSelection ? false : undefined;
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
      const pendingIntent = stateRef.current.pendingIntent;
      const transition = pendingContextTransitionRef.current;
      pendingContextTransitionRef.current = null;
      dispatch({ type: "discard" });
      if (pendingIntent?.type === "leave_context") {
        transition?.apply();
        return;
      }
      transition?.cancel?.();
    }, []);
    const requestContextTransition = useCallback(
      (
        applyTransition: () => void,
        cancelTransition?: () => void,
        options?: { force: boolean },
      ) => {
        const currentState = stateRef.current;
        if (currentState.selectedFile === null) {
          applyTransition();
          return;
        }
        const storedTransition = pendingContextTransitionRef.current;
        if (options?.force && currentState.leavePolicy !== "defer") {
          pendingContextTransitionRef.current = null;
          dispatch({ type: "force_clear" });
          storedTransition?.cancel?.();
          applyTransition();
          return;
        }
        if (
          storedTransition !== null &&
          (currentState.pendingIntent === null ||
            currentState.pendingIntent.type === "leave_context")
        ) {
          storedTransition.cancel?.();
          pendingContextTransitionRef.current = {
            apply: applyTransition,
            cancel: cancelTransition ?? null,
            force: options?.force === true || storedTransition.force,
          };
          return;
        }
        if (currentState.pendingIntent !== null || storedTransition !== null) {
          storedTransition?.cancel?.();
          pendingContextTransitionRef.current = null;
          cancelTransition?.();
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
          force: options?.force === true,
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

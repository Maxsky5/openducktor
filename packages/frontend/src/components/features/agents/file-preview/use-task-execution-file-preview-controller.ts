import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type {
  TaskExecutionFilePreviewLeavePolicy,
  TaskExecutionFileSelectionResult,
  TaskExecutionSelectedFile,
  TaskExecutionSelectedFilePreviewModel,
} from "@/components/features/agents";
import {
  createTaskExecutionFilePreviewState,
  taskExecutionFilePreviewReducer,
} from "@/components/features/agents/file-preview/task-execution-file-preview-state";

export type UseTaskExecutionFilePreviewControllerResult = {
  model: TaskExecutionSelectedFilePreviewModel;
  onSelectFile(file: TaskExecutionSelectedFile): TaskExecutionFileSelectionResult;
  requestContextTransition(
    applyTransition: () => void | Promise<void | boolean>,
    cancelTransition?: () => void,
    options?: { force?: boolean; waitForSuccess?: boolean },
  ): void;
};

type PendingContextTransition = {
  apply: () => void | Promise<void | boolean>;
  cancel: (() => void) | null;
  force: boolean;
  waitForSuccess: boolean;
};

export const useTaskExecutionFilePreviewController = (
  initialSelectedFile: TaskExecutionSelectedFile | null = null,
): UseTaskExecutionFilePreviewControllerResult => {
  const [state, dispatch] = useReducer(
    taskExecutionFilePreviewReducer,
    initialSelectedFile,
    createTaskExecutionFilePreviewState,
  );
  const stateRef = useRef(state);
  const pendingContextTransitionRef = useRef<PendingContextTransition | null>(null);
  const applyingTransitionRef = useRef(false);
  const [isApplyingTransition, setIsApplyingTransition] = useState(false);

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
    if (applyingTransitionRef.current) return;
    const transition = pendingContextTransitionRef.current;
    pendingContextTransitionRef.current = null;
    dispatch({ type: "keep_editing" });
    transition?.cancel?.();
  }, []);
  const onDiscard = useCallback(() => {
    if (applyingTransitionRef.current) return;
    const pendingIntent = stateRef.current.pendingIntent;
    const transition = pendingContextTransitionRef.current;
    if (pendingIntent?.type === "leave_context" && transition?.waitForSuccess) {
      applyingTransitionRef.current = true;
      setIsApplyingTransition(true);
      void Promise.resolve()
        .then(async () => (await transition.apply()) === true)
        .then((switched) => {
          pendingContextTransitionRef.current = null;
          dispatch({ type: switched ? "discard" : "keep_editing" });
        })
        .catch((error) => {
          pendingContextTransitionRef.current = null;
          dispatch({ type: "keep_editing" });
          toast.error("Could not switch branch", { description: errorMessage(error) });
        })
        .finally(() => {
          applyingTransitionRef.current = false;
          setIsApplyingTransition(false);
        });
      return;
    }
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
      applyTransition: () => void | Promise<void | boolean>,
      cancelTransition?: () => void,
      options?: { force?: boolean; waitForSuccess?: boolean },
    ) => {
      if (applyingTransitionRef.current) {
        cancelTransition?.();
        return;
      }
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
        (currentState.pendingIntent === null || currentState.pendingIntent.type === "leave_context")
      ) {
        storedTransition.cancel?.();
        pendingContextTransitionRef.current = {
          apply: applyTransition,
          cancel: cancelTransition ?? null,
          force: options?.force === true || storedTransition.force,
          waitForSuccess: options?.waitForSuccess === true,
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
        waitForSuccess: options?.waitForSuccess === true,
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
      isApplyingTransition,
      onClose,
      onLeavePolicyChange,
      onKeepEditing,
      onDiscard,
    }),
    [isApplyingTransition, onClose, onDiscard, onKeepEditing, onLeavePolicyChange, state],
  );

  return useMemo(
    () => ({ model, onSelectFile, requestContextTransition }),
    [model, onSelectFile, requestContextTransition],
  );
};

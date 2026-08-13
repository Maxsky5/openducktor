import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  TaskExecutionSelectedFile,
  TaskExecutionSelectedFilePreviewModel,
} from "@/components/features/agents";
import {
  createTaskExecutionFilePreviewState,
  taskExecutionFilePreviewReducer,
} from "./task-execution-file-preview-state";

type UseTaskExecutionFilePreviewControllerInput = {
  contextKey: string;
};

type UseTaskExecutionFilePreviewControllerResult = {
  model: TaskExecutionSelectedFilePreviewModel;
  onSelectFile(file: TaskExecutionSelectedFile): void;
};

export const useTaskExecutionFilePreviewController = ({
  contextKey,
}: UseTaskExecutionFilePreviewControllerInput): UseTaskExecutionFilePreviewControllerResult => {
  const [state, dispatch] = useReducer(
    taskExecutionFilePreviewReducer,
    undefined,
    createTaskExecutionFilePreviewState,
  );
  const previousContextKeyRef = useRef(contextKey);

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) return;
    previousContextKeyRef.current = contextKey;
    dispatch({ type: "clear" });
  }, [contextKey]);

  const onSelectFile = useCallback((file: TaskExecutionSelectedFile) => {
    dispatch({ type: "request", intent: { type: "select", file } });
  }, []);
  const onClose = useCallback(() => {
    dispatch({ type: "request", intent: { type: "close" } });
  }, []);
  const onEditStateChange = useCallback((editState: { isDirty: boolean; isSaving: boolean }) => {
    dispatch({ type: "report_edit_state", ...editState });
  }, []);
  const onKeepEditing = useCallback(() => {
    dispatch({ type: "keep_editing" });
  }, []);
  const onDiscard = useCallback(() => {
    dispatch({ type: "discard" });
  }, []);
  const model = useMemo<TaskExecutionSelectedFilePreviewModel>(
    () => ({
      selectedFile: state.selectedFile,
      previewSessionKey: state.previewSessionKey,
      preservePreviousSnapshot: state.preservePreviousSnapshot,
      hasPendingDiscard: state.pendingIntent !== null,
      onClose,
      onEditStateChange,
      onKeepEditing,
      onDiscard,
    }),
    [onClose, onDiscard, onEditStateChange, onKeepEditing, state],
  );

  return useMemo(() => ({ model, onSelectFile }), [model, onSelectFile]);
};

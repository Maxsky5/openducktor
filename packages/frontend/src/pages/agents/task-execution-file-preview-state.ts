import type { TaskExecutionSelectedFile } from "@/components/features/agents";

export type TaskExecutionFilePreviewIntent =
  | { type: "close" }
  | { type: "leave_context" }
  | { type: "select"; file: TaskExecutionSelectedFile };

export type TaskExecutionFilePreviewState = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  preservePreviousSnapshot: boolean;
  isDirty: boolean;
  isSaving: boolean;
  pendingIntent: TaskExecutionFilePreviewIntent | null;
};

export type TaskExecutionFilePreviewAction =
  | { type: "request"; intent: TaskExecutionFilePreviewIntent }
  | { type: "clear" }
  | { type: "report_edit_state"; isDirty: boolean; isSaving: boolean }
  | { type: "keep_editing" }
  | { type: "discard" };

export const createTaskExecutionFilePreviewState = (): TaskExecutionFilePreviewState => ({
  selectedFile: null,
  previewSessionKey: 0,
  preservePreviousSnapshot: false,
  isDirty: false,
  isSaving: false,
  pendingIntent: null,
});

const applyPreviewIntent = (
  state: TaskExecutionFilePreviewState,
  intent: TaskExecutionFilePreviewIntent,
): TaskExecutionFilePreviewState => {
  if (intent.type === "close" || intent.type === "leave_context") {
    if (state.selectedFile === null) return state;
    return {
      ...state,
      selectedFile: null,
      previewSessionKey: state.previewSessionKey + 1,
      preservePreviousSnapshot: false,
      isDirty: false,
      isSaving: false,
      pendingIntent: null,
    };
  }

  return {
    ...state,
    selectedFile: intent.file,
    previewSessionKey:
      state.selectedFile === null ? state.previewSessionKey + 1 : state.previewSessionKey,
    preservePreviousSnapshot: state.selectedFile !== null,
    isDirty: false,
    isSaving: false,
    pendingIntent: null,
  };
};

export const requestTaskExecutionFilePreviewIntent = (
  state: TaskExecutionFilePreviewState,
  intent: TaskExecutionFilePreviewIntent,
): TaskExecutionFilePreviewState => {
  if (state.pendingIntent !== null) return state;
  if (state.isSaving) {
    return intent.type === "leave_context" ? { ...state, pendingIntent: intent } : state;
  }
  if (state.isDirty) return { ...state, pendingIntent: intent };
  return applyPreviewIntent(state, intent);
};

export const clearTaskExecutionFilePreviewState = (
  state: TaskExecutionFilePreviewState,
): TaskExecutionFilePreviewState => requestTaskExecutionFilePreviewIntent(state, { type: "close" });

export const reportTaskExecutionFilePreviewEditState = (
  state: TaskExecutionFilePreviewState,
  editState: { isDirty: boolean; isSaving: boolean },
): TaskExecutionFilePreviewState => {
  if (
    state.selectedFile === null ||
    (state.isDirty === editState.isDirty && state.isSaving === editState.isSaving)
  ) {
    return state;
  }
  return { ...state, ...editState };
};

export const keepEditingTaskExecutionFilePreview = (
  state: TaskExecutionFilePreviewState,
): TaskExecutionFilePreviewState =>
  state.pendingIntent === null ? state : { ...state, pendingIntent: null };

export const discardTaskExecutionFilePreviewDraft = (
  state: TaskExecutionFilePreviewState,
): TaskExecutionFilePreviewState =>
  state.pendingIntent === null ? state : applyPreviewIntent(state, state.pendingIntent);

export const taskExecutionFilePreviewReducer = (
  state: TaskExecutionFilePreviewState,
  action: TaskExecutionFilePreviewAction,
): TaskExecutionFilePreviewState => {
  switch (action.type) {
    case "request":
      return requestTaskExecutionFilePreviewIntent(state, action.intent);
    case "clear":
      return clearTaskExecutionFilePreviewState(state);
    case "report_edit_state":
      return reportTaskExecutionFilePreviewEditState(state, action);
    case "keep_editing":
      return keepEditingTaskExecutionFilePreview(state);
    case "discard":
      return discardTaskExecutionFilePreviewDraft(state);
  }
};

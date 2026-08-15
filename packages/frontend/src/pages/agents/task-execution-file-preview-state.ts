import type {
  TaskExecutionFilePreviewLeavePolicy,
  TaskExecutionSelectedFile,
} from "@/components/features/agents";

export type TaskExecutionFilePreviewIntent =
  | { type: "close" }
  | { type: "leave_context" }
  | { type: "select"; file: TaskExecutionSelectedFile };

export type TaskExecutionFilePreviewState = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  preservePreviousSnapshot: boolean;
  leavePolicy: TaskExecutionFilePreviewLeavePolicy;
  pendingIntent: TaskExecutionFilePreviewIntent | null;
};

export type TaskExecutionFilePreviewAction =
  | { type: "request"; intent: TaskExecutionFilePreviewIntent }
  | { type: "clear" }
  | { type: "report_leave_policy"; policy: TaskExecutionFilePreviewLeavePolicy }
  | { type: "keep_editing" }
  | { type: "discard" };

export const createTaskExecutionFilePreviewState = (): TaskExecutionFilePreviewState => ({
  selectedFile: null,
  previewSessionKey: 0,
  preservePreviousSnapshot: false,
  leavePolicy: "allow",
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
      leavePolicy: "allow",
      pendingIntent: null,
    };
  }

  return {
    ...state,
    selectedFile: intent.file,
    previewSessionKey:
      state.selectedFile === null ? state.previewSessionKey + 1 : state.previewSessionKey,
    preservePreviousSnapshot: state.selectedFile !== null,
    leavePolicy: "allow",
    pendingIntent: null,
  };
};

export const requestTaskExecutionFilePreviewIntent = (
  state: TaskExecutionFilePreviewState,
  intent: TaskExecutionFilePreviewIntent,
): TaskExecutionFilePreviewState => {
  if (state.pendingIntent !== null) return state;
  if (state.leavePolicy === "defer") {
    return intent.type === "leave_context" ? { ...state, pendingIntent: intent } : state;
  }
  if (state.leavePolicy === "confirm") return { ...state, pendingIntent: intent };
  return applyPreviewIntent(state, intent);
};

export const clearTaskExecutionFilePreviewState = (
  state: TaskExecutionFilePreviewState,
): TaskExecutionFilePreviewState => requestTaskExecutionFilePreviewIntent(state, { type: "close" });

export const reportTaskExecutionFilePreviewLeavePolicy = (
  state: TaskExecutionFilePreviewState,
  policy: TaskExecutionFilePreviewLeavePolicy,
): TaskExecutionFilePreviewState => {
  if (state.selectedFile === null || state.leavePolicy === policy) {
    return state;
  }
  return { ...state, leavePolicy: policy };
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
    case "report_leave_policy":
      return reportTaskExecutionFilePreviewLeavePolicy(state, action.policy);
    case "keep_editing":
      return keepEditingTaskExecutionFilePreview(state);
    case "discard":
      return discardTaskExecutionFilePreviewDraft(state);
  }
};

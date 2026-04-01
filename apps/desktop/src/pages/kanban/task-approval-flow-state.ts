import type { TaskApprovalContext } from "@openducktor/contracts";
import type { PullRequestDraftMode, TaskApprovalMode } from "./kanban-page-model-types";

export type TaskApprovalFlowStage = "approval" | "complete_direct_merge";
export type TaskApprovalMergeMethod = "merge_commit" | "squash" | "rebase";

export type TaskApprovalFlowOpenState = {
  kind: "open";
  phase: "loading" | "ready" | "submitting";
  stage: TaskApprovalFlowStage;
  taskId: string;
  mode: TaskApprovalMode;
  mergeMethod: TaskApprovalMergeMethod;
  pullRequestDraftMode: PullRequestDraftMode;
  title: string;
  body: string;
  squashCommitMessage: string;
  squashCommitMessageTouched: boolean;
  errorMessage: string | null;
  approvalContext: TaskApprovalContext | null;
};

export type TaskApprovalFlowReadyState = TaskApprovalFlowOpenState & {
  phase: "ready";
  approvalContext: TaskApprovalContext;
};

export type TaskApprovalFlowState = { kind: "closed" } | TaskApprovalFlowOpenState;

type TaskApprovalFlowOpenPayload = {
  taskId: string;
  mode: TaskApprovalMode;
  pullRequestDraftMode: PullRequestDraftMode;
  title: string;
  body: string;
  errorMessage: string | null;
};

type TaskApprovalFlowAction =
  | ({ type: "open_loading" } & TaskApprovalFlowOpenPayload)
  | ({
      type: "load_succeeded";
      approvalContext: TaskApprovalContext;
    } & TaskApprovalFlowOpenPayload)
  | { type: "close" }
  | { type: "start_submitting" }
  | { type: "return_to_editable"; errorMessage: string | null }
  | { type: "clear_error" }
  | { type: "set_mode"; mode: TaskApprovalMode }
  | { type: "set_merge_method"; mergeMethod: TaskApprovalMergeMethod }
  | {
      type: "set_pull_request_draft_mode";
      pullRequestDraftMode: PullRequestDraftMode;
    }
  | { type: "set_title"; title: string }
  | { type: "set_body"; body: string }
  | { type: "set_squash_commit_message"; squashCommitMessage: string }
  | { type: "enter_direct_merge_completion"; approvalContext: TaskApprovalContext };

export const CLOSED_TASK_APPROVAL_STATE: TaskApprovalFlowState = {
  kind: "closed",
};

export const determineDefaultTaskApprovalMode = (
  context: TaskApprovalContext | undefined,
): TaskApprovalMode => {
  const githubProvider = context?.providers?.find((entry) => entry.providerId === "github");
  return githubProvider?.available ? "pull_request" : "direct_merge";
};

export const resolveTaskApprovalStage = (
  approvalContext: TaskApprovalContext | null,
): TaskApprovalFlowStage => (approvalContext?.directMerge ? "complete_direct_merge" : "approval");

export const isTaskApprovalOpen = (
  state: TaskApprovalFlowState,
): state is TaskApprovalFlowOpenState => state.kind === "open";

export const isTaskApprovalReady = (
  state: TaskApprovalFlowState,
): state is TaskApprovalFlowReadyState =>
  state.kind === "open" && state.phase === "ready" && state.approvalContext !== null;

const buildTaskApprovalLoadingState = (
  payload: TaskApprovalFlowOpenPayload,
): TaskApprovalFlowOpenState => ({
  kind: "open",
  phase: "loading",
  stage: "approval",
  taskId: payload.taskId,
  mode: payload.mode,
  mergeMethod: "merge_commit",
  pullRequestDraftMode: payload.pullRequestDraftMode,
  title: payload.title,
  body: payload.body,
  squashCommitMessage: "",
  squashCommitMessageTouched: false,
  errorMessage: payload.errorMessage,
  approvalContext: null,
});

const buildTaskApprovalLoadedState = (
  payload: TaskApprovalFlowOpenPayload & { approvalContext: TaskApprovalContext },
): TaskApprovalFlowOpenState => ({
  kind: "open",
  phase: "ready",
  stage: resolveTaskApprovalStage(payload.approvalContext),
  taskId: payload.taskId,
  mode: payload.mode,
  mergeMethod: payload.approvalContext.defaultMergeMethod,
  pullRequestDraftMode: payload.pullRequestDraftMode,
  title: payload.title,
  body: payload.body,
  squashCommitMessage: payload.approvalContext.suggestedSquashCommitMessage ?? "",
  squashCommitMessageTouched: false,
  errorMessage: payload.errorMessage,
  approvalContext: payload.approvalContext,
});

export function taskApprovalFlowReducer(
  state: TaskApprovalFlowState,
  action: TaskApprovalFlowAction,
): TaskApprovalFlowState {
  switch (action.type) {
    case "open_loading":
      return buildTaskApprovalLoadingState(action);
    case "load_succeeded":
      return buildTaskApprovalLoadedState(action);
    case "close":
      return CLOSED_TASK_APPROVAL_STATE;
    case "start_submitting":
      return state.kind === "open" ? { ...state, phase: "submitting" } : state;
    case "return_to_editable":
      return state.kind === "open" && state.phase === "submitting"
        ? { ...state, phase: "ready", errorMessage: action.errorMessage }
        : state;
    case "clear_error":
      return state.kind === "open" ? { ...state, errorMessage: null } : state;
    case "set_mode":
      return state.kind === "open" ? { ...state, mode: action.mode, errorMessage: null } : state;
    case "set_merge_method":
      return state.kind === "open"
        ? { ...state, mergeMethod: action.mergeMethod, errorMessage: null }
        : state;
    case "set_pull_request_draft_mode":
      return state.kind === "open"
        ? {
            ...state,
            pullRequestDraftMode: action.pullRequestDraftMode,
            errorMessage: null,
          }
        : state;
    case "set_title":
      return state.kind === "open" ? { ...state, title: action.title, errorMessage: null } : state;
    case "set_body":
      return state.kind === "open" ? { ...state, body: action.body, errorMessage: null } : state;
    case "set_squash_commit_message":
      return state.kind === "open"
        ? {
            ...state,
            squashCommitMessage: action.squashCommitMessage,
            squashCommitMessageTouched: true,
            errorMessage: null,
          }
        : state;
    case "enter_direct_merge_completion":
      return state.kind === "open"
        ? {
            ...state,
            phase: "ready",
            stage: "complete_direct_merge",
            approvalContext: action.approvalContext,
            errorMessage: null,
          }
        : state;
    default:
      return state;
  }
}

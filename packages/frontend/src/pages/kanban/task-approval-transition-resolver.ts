import type { TaskAction, TaskApprovalContext, TaskCard, TaskStatus } from "@openducktor/contracts";
import type { TaskApprovalMode } from "./kanban-page-model-types";
import {
  determineDefaultTaskApprovalMode,
  isTaskApprovalReady,
  type TaskApprovalFlowOpenState,
  type TaskApprovalFlowReadyState,
  type TaskApprovalFlowState,
} from "./task-approval-flow-state";

type ReviewStatus = Extract<TaskStatus, "ai_review" | "human_review">;
type ApprovalCompletionPath = "direct_merge" | "pull_request";
type TaskApprovalWorkflowCommand = "approve" | "request_changes";
type MissingBuilderWorktreeApprovalState = TaskApprovalFlowOpenState & {
  phase: "ready";
  stage: "missing_builder_worktree";
};

export type TaskApprovalWorkflowTransition =
  | {
      kind: "approved";
      action: "human_approve";
      fromStatus: ReviewStatus;
      toStatus: "closed";
      completionPath: ApprovalCompletionPath;
    }
  | {
      kind: "changes_requested";
      action: "human_request_changes";
      fromStatus: ReviewStatus;
      toStatus: "in_progress";
    }
  | {
      kind: "unavailable";
      status: TaskStatus;
      reason: "not_reviewable_status" | "action_unavailable";
      requiredAction: "human_approve" | "human_request_changes";
    };

export type TaskApprovalSubmissionRoute =
  | { kind: "ignore" }
  | {
      kind: "complete_missing_builder_worktree";
      approval: MissingBuilderWorktreeApprovalState;
    }
  | { kind: "submit_direct_merge"; approval: TaskApprovalFlowReadyState; repoPath: string }
  | { kind: "submit_pull_request"; approval: TaskApprovalFlowReadyState; repoPath: string };

const REVIEW_STATUSES = new Set<TaskStatus>(["ai_review", "human_review"]);

const isReviewStatus = (status: TaskStatus): status is ReviewStatus => REVIEW_STATUSES.has(status);

const hasTaskAction = (task: Pick<TaskCard, "availableActions">, action: TaskAction): boolean =>
  task.availableActions.includes(action);

const isMissingBuilderWorktreeApprovalState = (
  state: TaskApprovalFlowState,
): state is MissingBuilderWorktreeApprovalState =>
  state.kind === "open" && state.phase === "ready" && state.stage === "missing_builder_worktree";

export const resolveTaskApprovalWorkflowTransition = (
  task: Pick<TaskCard, "availableActions" | "pullRequest" | "status">,
  command: TaskApprovalWorkflowCommand,
): TaskApprovalWorkflowTransition => {
  const requiredAction = command === "approve" ? "human_approve" : "human_request_changes";

  if (!isReviewStatus(task.status)) {
    return {
      kind: "unavailable",
      status: task.status,
      reason: "not_reviewable_status",
      requiredAction,
    };
  }

  if (!hasTaskAction(task, requiredAction)) {
    return {
      kind: "unavailable",
      status: task.status,
      reason: "action_unavailable",
      requiredAction,
    };
  }

  if (command === "request_changes") {
    return {
      kind: "changes_requested",
      action: "human_request_changes",
      fromStatus: task.status,
      toStatus: "in_progress",
    };
  }

  return {
    kind: "approved",
    action: "human_approve",
    fromStatus: task.status,
    toStatus: "closed",
    completionPath: task.pullRequest ? "pull_request" : "direct_merge",
  };
};

export const resolveTaskApprovalOpenMode = (args: {
  cachedContext: TaskApprovalContext | undefined;
  requestedMode: TaskApprovalMode | undefined;
  task: Pick<TaskCard, "availableActions" | "pullRequest" | "status"> | undefined;
}): TaskApprovalMode => {
  if (args.requestedMode) {
    return args.requestedMode;
  }

  if (args.task) {
    const transition = resolveTaskApprovalWorkflowTransition(args.task, "approve");
    if (transition.kind === "approved" && transition.completionPath === "pull_request") {
      return "pull_request";
    }
  }

  return determineDefaultTaskApprovalMode(args.cachedContext);
};

export const resolveTaskApprovalSubmissionRoute = (
  state: TaskApprovalFlowState,
  repoPath: string | null,
): TaskApprovalSubmissionRoute => {
  if (isMissingBuilderWorktreeApprovalState(state)) {
    return {
      kind: "complete_missing_builder_worktree",
      approval: state,
    };
  }

  if (!repoPath || !isTaskApprovalReady(state)) {
    return { kind: "ignore" };
  }

  if (state.mode === "direct_merge") {
    return {
      kind: "submit_direct_merge",
      approval: state,
      repoPath,
    };
  }

  return {
    kind: "submit_pull_request",
    approval: state,
    repoPath,
  };
};

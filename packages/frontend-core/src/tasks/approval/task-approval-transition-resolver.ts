import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import type { TaskApprovalMode } from "./task-approval-types";
import {
  isTaskApprovalInteractive,
  isTaskApprovalReady,
  type TaskApprovalFlowInteractiveState,
  type TaskApprovalFlowOpenState,
  type TaskApprovalFlowReadyState,
  type TaskApprovalFlowState,
} from "./task-approval-flow-state";

type MissingBuilderWorktreeApprovalState = TaskApprovalFlowOpenState & {
  phase: "ready";
  stage: "missing_builder_worktree";
};

export type TaskApprovalSubmissionRoute =
  | { kind: "ignore" }
  | {
      kind: "close_missing_builder_worktree";
      approval: MissingBuilderWorktreeApprovalState;
    }
  | { kind: "close_task"; approval: TaskApprovalFlowInteractiveState }
  | { kind: "submit_direct_merge"; approval: TaskApprovalFlowReadyState; repoPath: string }
  | { kind: "submit_pull_request"; approval: TaskApprovalFlowReadyState; repoPath: string };

const isMissingBuilderWorktreeApprovalState = (
  state: TaskApprovalFlowState,
): state is MissingBuilderWorktreeApprovalState =>
  state.kind === "open" && state.phase === "ready" && state.stage === "missing_builder_worktree";

export const resolveTaskApprovalOpenMode = (args: {
  gitProviderContext: RepositoryGitProviderContext;
  requestedMode: TaskApprovalMode | undefined;
}): TaskApprovalMode => {
  if (args.requestedMode === "direct_merge" || args.requestedMode === "close_task") {
    return args.requestedMode;
  }

  const supportsPullRequests =
    args.gitProviderContext?.descriptor.capabilities.supportsPullRequests === true;
  if (!supportsPullRequests) {
    return "direct_merge";
  }

  if (args.requestedMode === "pull_request") {
    return args.requestedMode;
  }

  return "pull_request";
};

export const resolveCurrentTaskApprovalMode = (
  mode: TaskApprovalMode,
  gitProviderContext: RepositoryGitProviderContext | undefined,
): TaskApprovalMode => {
  const pullRequestsUnsupported =
    gitProviderContext !== undefined &&
    gitProviderContext?.descriptor.capabilities.supportsPullRequests !== true;
  return mode === "pull_request" && pullRequestsUnsupported ? "direct_merge" : mode;
};

export const resolveTaskApprovalSubmissionRoute = (
  state: TaskApprovalFlowState,
  repoPath: string | null,
): TaskApprovalSubmissionRoute => {
  if (isMissingBuilderWorktreeApprovalState(state)) {
    return {
      kind: "close_missing_builder_worktree",
      approval: state,
    };
  }

  if (state.kind === "open" && state.stage === "complete_direct_merge") {
    return { kind: "ignore" };
  }

  // A close needs no approval context, so it works when that read failed.
  if (repoPath && isTaskApprovalInteractive(state) && state.mode === "close_task") {
    return { kind: "close_task", approval: state };
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

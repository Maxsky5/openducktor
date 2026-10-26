import type { GitConflictAssistanceResult } from "../../git/conflicts/conflict-assistance";
import type { PullRequest, RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { GitConflict } from "../../git/contracts";
import { errorMessage } from "../../lib/errors";
import { useSingleFlight } from "../../lib/use-single-flight";
import { loadTaskApprovalContextFromQuery } from "../../queries/task-approval";
import { isOutcomeUnknown } from "../../lib/command-outcome";
import type { ActiveWorkspace } from "../../types/session-slices";
import type {
  TaskApprovalModalModel,
  TaskApprovalOpenOptions,
  TaskGitConflictDialogModel,
} from "./task-approval-types";
import {
  completeDirectMergeApproval,
  submitDirectMergeApproval,
} from "./task-approval-flow-direct-merge";
import { submitPullRequestApproval } from "./task-approval-flow-pull-request";
import {
  CLOSED_TASK_APPROVAL_STATE,
  isTaskApprovalInteractive,
  isTaskApprovalOpen,
  isTaskApprovalReady,
  taskApprovalFlowReducer,
  type TaskApprovalWorkspaceIdentity,
} from "./task-approval-flow-state";
import { buildTaskApprovalModalModel } from "./task-approval-modal-model";
import {
  resolveCurrentTaskApprovalMode,
  resolveTaskApprovalOpenMode,
  resolveTaskApprovalSubmissionRoute,
} from "./task-approval-transition-resolver";
import { useTaskApprovalGitConflictFlow } from "./use-task-approval-git-conflict-flow";
import { useClientConnection, useHostClient } from "../../connection/client-connection-react";

type UseTaskApprovalFlowArgs = {
  activeWorkspace: ActiveWorkspace | null;
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderContextError: Error | null;
  loadGitProviderContext: () => Promise<RepositoryGitProviderContext>;
  tasks: TaskCard[];
  requestPullRequestGeneration: (taskId: string) => Promise<string | undefined>;
  refreshTasks: () => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  openResetImplementation: (taskId: string) => boolean;
  onResolveGitConflict?: (
    conflict: GitConflict,
    taskId: string,
  ) => Promise<GitConflictAssistanceResult>;
  /** Shows the created pull request. A platform can offer to open it. */
  showPullRequestCreated: (pullRequest: PullRequest) => void;
  /** Shows a failed Git provider read. `retry` opens the approval again. */
  showGitProviderContextLoadFailure: (description: string, retry: () => void) => void;
};

type UseTaskApprovalFlowResult = {
  taskApprovalModal: TaskApprovalModalModel | null;
  taskGitConflictDialog: TaskGitConflictDialogModel | null;
  openTaskApproval: (taskId: string, options?: TaskApprovalOpenOptions) => void;
};

const hasSameWorkspaceIdentity = (
  left: TaskApprovalWorkspaceIdentity | null,
  right: TaskApprovalWorkspaceIdentity | null,
): boolean => left?.workspaceId === right?.workspaceId && left?.repoPath === right?.repoPath;

export function useTaskApprovalFlow({
  activeWorkspace,
  gitProviderContext,
  gitProviderContextError,
  loadGitProviderContext,
  tasks,
  requestPullRequestGeneration,
  refreshTasks,
  humanApproveTask,
  openResetImplementation,
  onResolveGitConflict = async (): Promise<GitConflictAssistanceResult> => {
    throw new Error(
      "onResolveGitConflict handler is required to use the Ask Builder conflict-resolution path.",
    );
  },
  showPullRequestCreated,
  showGitProviderContextLoadFailure,
}: UseTaskApprovalFlowArgs): UseTaskApprovalFlowResult {
  const host = useHostClient();
  const { feedback } = useClientConnection();
  const queryClient = useQueryClient();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceIdentity = useMemo(
    () =>
      workspaceRepoPath && activeWorkspaceId
        ? { repoPath: workspaceRepoPath, workspaceId: activeWorkspaceId }
        : null,
    [activeWorkspaceId, workspaceRepoPath],
  );
  const [state, dispatch] = useReducer(taskApprovalFlowReducer, CLOSED_TASK_APPROVAL_STATE);
  // One approval command at a time, so a double tap approves or merges once.
  const submitFlight = useSingleFlight();
  const approvalRequestVersionRef = useRef(0);
  const workspaceIdentityRef = useRef<TaskApprovalWorkspaceIdentity | null>(workspaceIdentity);

  const reset = useCallback(() => {
    approvalRequestVersionRef.current += 1;
    dispatch({ type: "close" });
  }, []);

  useLayoutEffect(() => {
    if (hasSameWorkspaceIdentity(workspaceIdentityRef.current, workspaceIdentity)) {
      return;
    }
    workspaceIdentityRef.current = workspaceIdentity;
    reset();
  }, [reset, workspaceIdentity]);

  const isApprovalRequestCurrent = useCallback(
    (requestVersion: number, requestWorkspace: TaskApprovalWorkspaceIdentity): boolean =>
      approvalRequestVersionRef.current === requestVersion &&
      hasSameWorkspaceIdentity(workspaceIdentityRef.current, requestWorkspace),
    [],
  );

  const openTaskApproval = useCallback(
    function openTaskApprovalRequest(taskId: string, options?: TaskApprovalOpenOptions): void {
      if (
        !workspaceIdentity ||
        !hasSameWorkspaceIdentity(workspaceIdentityRef.current, workspaceIdentity)
      ) {
        return;
      }

      const requestWorkspace = workspaceIdentity;
      const task = tasks.find((entry) => entry.id === taskId);
      const requestVersion = ++approvalRequestVersionRef.current;
      const title = task?.title ?? "";
      const body = task?.description ?? "";
      const pullRequestDraftMode = options?.pullRequestDraftMode ?? "generate_ai";
      const openErrorMessage = options?.errorMessage ?? null;
      const initialMode =
        options?.mode ??
        (gitProviderContext
          ? resolveTaskApprovalOpenMode({
              gitProviderContext,
              requestedMode: undefined,
            })
          : "direct_merge");

      dispatch({
        type: "open_loading",
        taskId,
        mode: initialMode,
        pullRequestDraftMode,
        title,
        body,
        errorMessage: openErrorMessage,
        workspaceIdentity: requestWorkspace,
      });

      void (async () => {
        let effectiveMode = initialMode;
        if (options?.mode !== "direct_merge") {
          try {
            const resolvedGitProviderContext = await loadGitProviderContext();
            effectiveMode = resolveTaskApprovalOpenMode({
              gitProviderContext: resolvedGitProviderContext,
              requestedMode: options?.mode,
            });
          } catch (error) {
            if (isApprovalRequestCurrent(requestVersion, requestWorkspace)) {
              showGitProviderContextLoadFailure(errorMessage(error), () =>
                openTaskApprovalRequest(taskId, options),
              );
            }
            effectiveMode = "direct_merge";
          }
        }
        if (!isApprovalRequestCurrent(requestVersion, requestWorkspace)) {
          return;
        }
        if (effectiveMode !== initialMode) {
          dispatch({ type: "set_mode", mode: effectiveMode });
        }

        try {
          const approvalContextResult = await loadTaskApprovalContextFromQuery(
            queryClient,
            requestWorkspace.repoPath,
            taskId,
          );
          if (isApprovalRequestCurrent(requestVersion, requestWorkspace)) {
            if (approvalContextResult.outcome === "missing_builder_worktree") {
              dispatch({
                type: "load_missing_builder_worktree",
                taskId,
                mode: effectiveMode,
                pullRequestDraftMode,
                title,
                body,
                errorMessage: openErrorMessage,
                workspaceIdentity: requestWorkspace,
              });
            } else {
              const approvalContext = approvalContextResult.approvalContext;
              dispatch({
                type: "load_succeeded",
                taskId,
                mode: effectiveMode,
                pullRequestDraftMode,
                title,
                body,
                errorMessage: openErrorMessage,
                approvalContext,
                workspaceIdentity: requestWorkspace,
              });
            }
          }
        } catch (error) {
          if (isApprovalRequestCurrent(requestVersion, requestWorkspace)) {
            reset();
            feedback.show("error", "Failed to open approval flow", {
              description: errorMessage(error),
            });
          }
        }
      })();
    },
    [
      feedback,
      isApprovalRequestCurrent,
      gitProviderContext,
      loadGitProviderContext,
      queryClient,
      reset,
      showGitProviderContextLoadFailure,
      tasks,
      workspaceIdentity,
    ],
  );
  const { taskGitConflictDialog, openGitConflictDialog } = useTaskApprovalGitConflictFlow({
    onResolveGitConflict,
    openTaskApproval,
    reset,
    workspaceRepoPath,
  });

  const confirm = useCallback((): void => {
    if (
      !isTaskApprovalOpen(state) ||
      !hasSameWorkspaceIdentity(workspaceIdentityRef.current, state.workspaceIdentity)
    ) {
      reset();
      return;
    }

    const submissionWorkspace = state.workspaceIdentity;
    const submissionVersion = approvalRequestVersionRef.current;
    const mode = resolveCurrentTaskApprovalMode(state.mode, gitProviderContext);
    const submissionState = mode === state.mode ? state : { ...state, mode };
    const submissionRoute = resolveTaskApprovalSubmissionRoute(
      submissionState,
      submissionWorkspace.repoPath,
    );
    if (submissionRoute.kind === "ignore") {
      return;
    }

    const canSubmitPullRequest =
      gitProviderContextError === null &&
      gitProviderContext?.descriptor.capabilities.supportsPullRequests === true &&
      gitProviderContext.config.enabled &&
      gitProviderContext.health.available;
    if (submissionRoute.kind === "submit_pull_request" && !canSubmitPullRequest) {
      return;
    }

    if (submissionRoute.kind === "complete_missing_builder_worktree") {
      const approvalState = submissionRoute.approval;
      void submitFlight.start(async () => {
        dispatch({ type: "clear_error" });
        dispatch({ type: "start_submitting" });
        try {
          await humanApproveTask(approvalState.taskId);
          if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
            return;
          }
          reset();
        } catch (error) {
          if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
            return;
          }
          const description = errorMessage(error);
          dispatch({
            type: "return_to_editable",
            errorMessage: description,
            errorOutcomeUnknown: isOutcomeUnknown(error),
          });
          feedback.show("error", "Approval failed", {
            description,
          });
        }
      });
      return;
    }

    const approvalState = submissionRoute.approval;
    const repoPath = submissionRoute.repoPath;
    void submitFlight.start(async () => {
      dispatch({ type: "start_submitting" });
      try {
        if (submissionRoute.kind === "submit_direct_merge") {
          const directMergeResult = await submitDirectMergeApproval({
            approval: approvalState,
            queryClient,
            repoPath,
            refreshTasks,
            workspaceId: submissionWorkspace.workspaceId,
          });
          if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
            return;
          }
          if (directMergeResult.outcome === "conflicts") {
            reset();
            openGitConflictDialog(approvalState.taskId, directMergeResult.conflict);
            return;
          }

          if (directMergeResult.outcome === "task_closed") {
            reset();
            feedback.show("success", "Task approved", {
              description: directMergeResult.successDescription,
            });
            return;
          }

          dispatch({
            type: "enter_direct_merge_completion",
            approvalContext: directMergeResult.approvalContext,
          });
          return;
        }

        const pullRequestResult = await submitPullRequestApproval({
          host,
          approval: approvalState,
          repoPath,
          requestPullRequestGeneration,
          refreshTasks,
        });
        if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
          return;
        }
        if (pullRequestResult.outcome === "generation_started") {
          reset();
          return;
        }
        if (pullRequestResult.outcome === "generation_cancelled") {
          dispatch({ type: "return_to_editable", errorMessage: null, errorOutcomeUnknown: false });
          return;
        }

        showPullRequestCreated(pullRequestResult.pullRequest);
        reset();
      } catch (error) {
        if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
          return;
        }
        const description = errorMessage(error);
        dispatch({
          type: "return_to_editable",
          errorMessage: description,
          errorOutcomeUnknown: isOutcomeUnknown(error),
        });
        feedback.show("error", "Approval failed", {
          description,
        });
      }
    });
  }, [
    feedback,
    host,
    humanApproveTask,
    gitProviderContext,
    gitProviderContextError,
    isApprovalRequestCurrent,
    queryClient,
    openGitConflictDialog,
    refreshTasks,
    requestPullRequestGeneration,
    reset,
    showPullRequestCreated,
    state,
    submitFlight,
  ]);

  const resetMissingBuilderWorktree = useCallback((): void => {
    if (
      !isTaskApprovalInteractive(state) ||
      state.stage !== "missing_builder_worktree" ||
      !hasSameWorkspaceIdentity(workspaceIdentityRef.current, state.workspaceIdentity)
    ) {
      return;
    }

    if (openResetImplementation(state.taskId)) {
      reset();
    }
  }, [openResetImplementation, reset, state]);

  const completeDirectMerge = useCallback((): void => {
    if (
      !isTaskApprovalReady(state) ||
      !hasSameWorkspaceIdentity(workspaceIdentityRef.current, state.workspaceIdentity)
    ) {
      return;
    }

    const approvalState = state;
    const submissionWorkspace = approvalState.workspaceIdentity;
    const submissionVersion = approvalRequestVersionRef.current;
    void submitFlight.start(async () => {
      dispatch({ type: "clear_error" });
      dispatch({ type: "start_submitting" });
      try {
        const result = await completeDirectMergeApproval({
          approval: approvalState,
          queryClient,
          repoPath: submissionWorkspace.repoPath,
          refreshTasks,
          workspaceId: submissionWorkspace.workspaceId,
        });
        if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
          return;
        }
        reset();
        feedback.show("success", "Task moved to Done", {
          description: result.successDescription,
        });
      } catch (error) {
        if (!isApprovalRequestCurrent(submissionVersion, submissionWorkspace)) {
          return;
        }
        const description = errorMessage(error);
        dispatch({
          type: "return_to_editable",
          errorMessage: description,
          errorOutcomeUnknown: isOutcomeUnknown(error),
        });
        feedback.show("error", "Failed to finish direct merge", {
          description,
        });
      }
    });
  }, [feedback, isApprovalRequestCurrent, queryClient, refreshTasks, reset, state, submitFlight]);

  if (!isTaskApprovalOpen(state)) {
    return {
      taskApprovalModal: null,
      taskGitConflictDialog,
      openTaskApproval,
    };
  }

  const taskApprovalModal = buildTaskApprovalModalModel({
    completeDirectMerge,
    confirm,
    dispatch,
    reset,
    resetMissingBuilderWorktree,
    state,
    gitProviderContext,
    gitProviderContextError,
  });

  return {
    taskApprovalModal,
    taskGitConflictDialog,
    openTaskApproval,
  };
}

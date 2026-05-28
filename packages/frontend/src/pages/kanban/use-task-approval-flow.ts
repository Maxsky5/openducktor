import type { TaskApprovalContextLoadResult, TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { GitConflict } from "@/features/agent-studio-git";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  loadTaskApprovalContextFromQuery,
  taskApprovalQueryKeys,
} from "@/state/queries/task-approval";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { KanbanPageModels, TaskApprovalModalModel } from "./kanban-page-model-types";
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
} from "./task-approval-flow-state";
import { buildTaskApprovalModalModel } from "./task-approval-modal-model";
import {
  resolveTaskApprovalOpenMode,
  resolveTaskApprovalSubmissionRoute,
} from "./task-approval-transition-resolver";
import { useTaskApprovalGitConflictFlow } from "./use-task-approval-git-conflict-flow";

type UseTaskApprovalFlowArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  requestPullRequestGeneration: (taskId: string) => Promise<string | undefined>;
  refreshTasks: () => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  openResetImplementation: (taskId: string) => boolean;
  onResolveGitConflict?: (conflict: GitConflict, taskId: string) => Promise<boolean>;
};

type TaskApprovalOpenOptions = {
  mode?: "direct_merge" | "pull_request";
  pullRequestDraftMode?: "manual" | "generate_ai";
  errorMessage?: string | null;
};

type UseTaskApprovalFlowResult = {
  taskApprovalModal: TaskApprovalModalModel | null;
  taskGitConflictDialog: KanbanPageModels["taskGitConflictDialog"];
  openTaskApproval: (taskId: string, options?: TaskApprovalOpenOptions) => void;
};

export function useTaskApprovalFlow({
  activeWorkspace,
  tasks,
  requestPullRequestGeneration,
  refreshTasks,
  humanApproveTask,
  openResetImplementation,
  onResolveGitConflict = async (): Promise<boolean> => {
    throw new Error(
      "onResolveGitConflict handler is required to use the Ask Builder conflict-resolution path.",
    );
  },
}: UseTaskApprovalFlowArgs): UseTaskApprovalFlowResult {
  const queryClient = useQueryClient();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [state, dispatch] = useReducer(taskApprovalFlowReducer, CLOSED_TASK_APPROVAL_STATE);
  const approvalRequestVersionRef = useRef(0);

  const reset = useCallback(() => {
    approvalRequestVersionRef.current += 1;
    dispatch({ type: "close" });
  }, []);

  const openTaskApproval = useCallback(
    (taskId: string, options?: TaskApprovalOpenOptions): void => {
      if (!workspaceRepoPath) {
        return;
      }

      const task = tasks.find((entry) => entry.id === taskId);
      const requestVersion = ++approvalRequestVersionRef.current;

      const cachedContext = queryClient.getQueryData(
        taskApprovalQueryKeys.context(workspaceRepoPath, taskId),
      ) as TaskApprovalContextLoadResult | undefined;
      const cachedApprovalContext =
        cachedContext?.outcome === "ready" ? cachedContext.approvalContext : undefined;
      const effectiveMode = resolveTaskApprovalOpenMode({
        cachedContext: cachedApprovalContext,
        requestedMode: options?.mode,
        task,
      });
      const title = task?.title ?? "";
      const body = task?.description ?? "";
      const pullRequestDraftMode = options?.pullRequestDraftMode ?? "manual";
      const openErrorMessage = options?.errorMessage ?? null;

      dispatch({
        type: "open_loading",
        taskId,
        mode: effectiveMode,
        pullRequestDraftMode,
        title,
        body,
        errorMessage: openErrorMessage,
      });

      void (async () => {
        try {
          const approvalContextResult = await loadTaskApprovalContextFromQuery(
            queryClient,
            workspaceRepoPath,
            taskId,
          );
          if (approvalRequestVersionRef.current !== requestVersion) {
            return;
          }
          if (approvalContextResult.outcome === "missing_builder_worktree") {
            dispatch({
              type: "load_missing_builder_worktree",
              taskId,
              mode: effectiveMode,
              pullRequestDraftMode,
              title,
              body,
              errorMessage: openErrorMessage,
            });
            return;
          }

          const approvalContext = approvalContextResult.approvalContext;
          const updatedEffectiveMode = resolveTaskApprovalOpenMode({
            cachedContext: approvalContext,
            requestedMode: options?.mode,
            task,
          });
          dispatch({
            type: "load_succeeded",
            taskId,
            mode: updatedEffectiveMode,
            pullRequestDraftMode,
            title,
            body,
            errorMessage: openErrorMessage,
            approvalContext,
          });
        } catch (error) {
          if (approvalRequestVersionRef.current !== requestVersion) {
            return;
          }
          reset();
          toast.error("Failed to open approval flow", {
            description: errorMessage(error),
          });
        }
      })();
    },
    [workspaceRepoPath, queryClient, reset, tasks],
  );
  const { taskGitConflictDialog, openGitConflictDialog } = useTaskApprovalGitConflictFlow({
    onResolveGitConflict,
    openTaskApproval,
    reset,
    workspaceRepoPath,
  });

  const confirm = useCallback((): void => {
    const submissionRoute = resolveTaskApprovalSubmissionRoute(state, workspaceRepoPath);
    if (submissionRoute.kind === "ignore") {
      return;
    }

    if (submissionRoute.kind === "complete_missing_builder_worktree") {
      const approvalState = submissionRoute.approval;
      void (async () => {
        dispatch({ type: "clear_error" });
        dispatch({ type: "start_submitting" });
        try {
          await humanApproveTask(approvalState.taskId);
          reset();
        } catch (error) {
          const description = errorMessage(error);
          dispatch({ type: "return_to_editable", errorMessage: description });
          toast.error("Approval failed", {
            description,
          });
        }
      })();
      return;
    }

    const approvalState = submissionRoute.approval;
    const repoPath = submissionRoute.repoPath;
    void (async () => {
      dispatch({ type: "start_submitting" });
      try {
        if (submissionRoute.kind === "submit_direct_merge") {
          const directMergeResult = await submitDirectMergeApproval({
            approval: approvalState,
            queryClient,
            repoPath,
            refreshTasks,
          });
          if (directMergeResult.outcome === "conflicts") {
            reset();
            openGitConflictDialog(approvalState.taskId, directMergeResult.conflict);
            return;
          }

          if (directMergeResult.outcome === "task_closed") {
            reset();
            toast.success("Task approved", {
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
          approval: approvalState,
          repoPath,
          requestPullRequestGeneration,
          refreshTasks,
        });
        if (pullRequestResult.outcome === "generation_started") {
          reset();
          return;
        }
        if (pullRequestResult.outcome === "generation_cancelled") {
          dispatch({ type: "return_to_editable", errorMessage: null });
          return;
        }

        toast.success("Pull request created", {
          description: `PR #${pullRequestResult.pullRequest.number}`,
          action: {
            label: "Open",
            onClick: () => {
              void openExternalUrl(pullRequestResult.pullRequest.url).catch((error) => {
                toast.error("Failed to open pull request", {
                  description: errorMessage(error),
                });
              });
            },
          },
        });
        reset();
      } catch (error) {
        const description = errorMessage(error);
        dispatch({ type: "return_to_editable", errorMessage: description });
        toast.error("Approval failed", {
          description,
        });
      }
    })();
  }, [
    workspaceRepoPath,
    humanApproveTask,
    queryClient,
    openGitConflictDialog,
    refreshTasks,
    requestPullRequestGeneration,
    reset,
    state,
  ]);

  const resetMissingBuilderWorktree = useCallback((): void => {
    if (!isTaskApprovalInteractive(state) || state.stage !== "missing_builder_worktree") {
      return;
    }

    if (openResetImplementation(state.taskId)) {
      reset();
    }
  }, [openResetImplementation, reset, state]);

  const completeDirectMerge = useCallback((): void => {
    if (!workspaceRepoPath || !isTaskApprovalReady(state)) {
      return;
    }

    const approvalState = state;
    void (async () => {
      dispatch({ type: "clear_error" });
      dispatch({ type: "start_submitting" });
      try {
        const result = await completeDirectMergeApproval({
          approval: approvalState,
          repoPath: workspaceRepoPath,
          refreshTasks,
        });
        reset();
        toast.success("Task moved to Done", {
          description: result.successDescription,
        });
      } catch (error) {
        const description = errorMessage(error);
        dispatch({ type: "return_to_editable", errorMessage: description });
        toast.error("Failed to finish direct merge", {
          description,
        });
      }
    })();
  }, [workspaceRepoPath, refreshTasks, reset, state]);

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
  });

  return {
    taskApprovalModal,
    taskGitConflictDialog,
    openTaskApproval,
  };
}

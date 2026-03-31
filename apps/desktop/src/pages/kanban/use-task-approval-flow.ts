import type { TaskApprovalContext, TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  loadTaskApprovalContextFromQuery,
  taskApprovalQueryKeys,
} from "@/state/queries/task-approval";
import type { TaskApprovalModalModel } from "./kanban-page-model-types";
import {
  completeDirectMergeApproval,
  submitDirectMergeApproval,
} from "./task-approval-flow-direct-merge";
import {
  abortTaskApprovalGitConflict,
  askBuilderToResolveTaskApprovalGitConflict,
} from "./task-approval-flow-git-conflict";
import { submitPullRequestApproval } from "./task-approval-flow-pull-request";
import {
  CLOSED_TASK_APPROVAL_STATE,
  determineDefaultTaskApprovalMode,
  isTaskApprovalOpen,
  isTaskApprovalReady,
  taskApprovalFlowReducer,
} from "./task-approval-flow-state";

type UseTaskApprovalFlowArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  requestPullRequestGeneration: (taskId: string) => Promise<string | undefined>;
  refreshTasks: () => Promise<void>;
  onResolveGitConflict?: (conflict: GitConflict, taskId: string) => Promise<boolean>;
};

const INITIAL_GIT_CONFLICT_STATE: {
  open: boolean;
  taskId: string | null;
  conflict: GitConflict | null;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction;
} = {
  open: false,
  taskId: null,
  conflict: null,
  isHandlingConflict: false,
  conflictAction: null,
};

export function useTaskApprovalFlow({
  activeRepo,
  tasks,
  requestPullRequestGeneration,
  refreshTasks,
  onResolveGitConflict = async (): Promise<boolean> => {
    throw new Error(
      "onResolveGitConflict handler is required to use the Ask Builder conflict-resolution path.",
    );
  },
}: UseTaskApprovalFlowArgs): {
  taskApprovalModal: TaskApprovalModalModel | null;
  taskGitConflictDialog: {
    open: boolean;
    conflict: GitConflict | null;
    isHandlingConflict: boolean;
    conflictAction: GitConflictAction;
    onOpenChange: (open: boolean) => void;
    onAbort: () => void;
    onAskBuilder: () => void;
  } | null;
  openTaskApproval: (
    taskId: string,
    options?: {
      mode?: "direct_merge" | "pull_request";
      pullRequestDraftMode?: "manual" | "generate_ai";
      errorMessage?: string | null;
    },
  ) => void;
} {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(taskApprovalFlowReducer, CLOSED_TASK_APPROVAL_STATE);
  const [gitConflictState, setGitConflictState] = useState(INITIAL_GIT_CONFLICT_STATE);
  const approvalRequestVersionRef = useRef(0);

  const reset = useCallback(() => {
    approvalRequestVersionRef.current += 1;
    dispatch({ type: "close" });
  }, []);

  const closeGitConflict = useCallback(() => {
    setGitConflictState(INITIAL_GIT_CONFLICT_STATE);
  }, []);

  const openTaskApproval = useCallback(
    (
      taskId: string,
      options?: {
        mode?: "direct_merge" | "pull_request";
        pullRequestDraftMode?: "manual" | "generate_ai";
        errorMessage?: string | null;
      },
    ): void => {
      if (!activeRepo) {
        return;
      }

      const task = tasks.find((entry) => entry.id === taskId);
      const requestVersion = ++approvalRequestVersionRef.current;

      const cachedContext = queryClient.getQueryData(
        taskApprovalQueryKeys.context(activeRepo, taskId),
      ) as TaskApprovalContext | undefined;
      const effectiveMode = options?.mode ?? determineDefaultTaskApprovalMode(cachedContext);
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
          const approvalContext = await loadTaskApprovalContextFromQuery(
            queryClient,
            activeRepo,
            taskId,
          );
          if (approvalRequestVersionRef.current !== requestVersion) {
            return;
          }
          const updatedEffectiveMode =
            options?.mode ?? determineDefaultTaskApprovalMode(approvalContext);
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
    [activeRepo, queryClient, reset, tasks],
  );

  const confirm = useCallback((): void => {
    if (!activeRepo || !isTaskApprovalReady(state)) {
      return;
    }
    const approvalState = state;

    void (async () => {
      dispatch({ type: "start_submitting" });
      try {
        if (approvalState.mode === "direct_merge") {
          const directMergeResult = await submitDirectMergeApproval({
            approval: approvalState,
            queryClient,
            repoPath: activeRepo,
            refreshTasks,
          });
          if (directMergeResult.outcome === "conflicts") {
            reset();
            setGitConflictState({
              open: true,
              taskId: approvalState.taskId,
              conflict: directMergeResult.conflict,
              isHandlingConflict: false,
              conflictAction: null,
            });
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
          repoPath: activeRepo,
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
        dispatch({ type: "return_to_editable", errorMessage: null });
        toast.error("Approval failed", {
          description: errorMessage(error),
        });
      }
    })();
  }, [activeRepo, queryClient, refreshTasks, requestPullRequestGeneration, reset, state]);

  const abortGitConflict = useCallback((): void => {
    if (!activeRepo || !gitConflictState.conflict || gitConflictState.isHandlingConflict) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        isHandlingConflict: true,
        conflictAction: "abort",
      }));
      try {
        await abortTaskApprovalGitConflict(activeRepo, conflict);
        toast.success(getGitConflictCopy(conflict.operation).abortedToastTitle);
        closeGitConflict();
        if (taskId) {
          openTaskApproval(taskId, {
            mode: "direct_merge",
          });
        }
      } catch (error) {
        const description = errorMessage(error);
        toast.error(getGitConflictCopy(conflict.operation).abortFailureTitle, {
          description,
        });
        setGitConflictState((current) => ({
          ...current,
          isHandlingConflict: false,
          conflictAction: null,
        }));
      }
    })();
  }, [activeRepo, closeGitConflict, gitConflictState, openTaskApproval]);

  const askBuilderToResolveGitConflict = useCallback((): void => {
    if (
      !gitConflictState.conflict ||
      !gitConflictState.taskId ||
      gitConflictState.isHandlingConflict
    ) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        isHandlingConflict: true,
        conflictAction: "ask_builder",
      }));
      try {
        const wasHandled = await askBuilderToResolveTaskApprovalGitConflict(
          conflict,
          taskId,
          onResolveGitConflict,
        );
        if (!wasHandled) {
          setGitConflictState((current) => ({
            ...current,
            isHandlingConflict: false,
            conflictAction: null,
          }));
          return;
        }
        closeGitConflict();
        reset();
      } catch (error) {
        const description = errorMessage(error);
        toast.error("Failed to contact Builder", {
          description,
        });
        setGitConflictState((current) => ({
          ...current,
          isHandlingConflict: false,
          conflictAction: null,
        }));
      }
    })();
  }, [closeGitConflict, gitConflictState, onResolveGitConflict, reset]);

  const completeDirectMerge = useCallback((): void => {
    if (!activeRepo || !isTaskApprovalReady(state)) {
      return;
    }

    const approvalState = state;
    void (async () => {
      dispatch({ type: "clear_error" });
      dispatch({ type: "start_submitting" });
      try {
        const result = await completeDirectMergeApproval({
          approval: approvalState,
          repoPath: activeRepo,
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
  }, [activeRepo, refreshTasks, reset, state]);

  const taskGitConflictDialog = gitConflictState.conflict
    ? {
        open: gitConflictState.open,
        conflict: gitConflictState.conflict,
        isHandlingConflict: gitConflictState.isHandlingConflict,
        conflictAction: gitConflictState.conflictAction,
        onOpenChange: (open: boolean) => {
          if (!open && !gitConflictState.isHandlingConflict) {
            closeGitConflict();
          }
        },
        onAbort: abortGitConflict,
        onAskBuilder: askBuilderToResolveGitConflict,
      }
    : null;

  if (!isTaskApprovalOpen(state)) {
    return {
      taskApprovalModal: null,
      taskGitConflictDialog,
      openTaskApproval,
    };
  }

  const approvalContext = state.approvalContext;
  const githubProvider = approvalContext?.providers.find((entry) => entry.providerId === "github");

  return {
    taskApprovalModal: {
      open: true,
      stage: state.stage,
      taskId: state.taskId,
      isLoading: state.phase === "loading",
      mode: state.mode,
      mergeMethod: state.mergeMethod,
      pullRequestDraftMode: state.pullRequestDraftMode,
      pullRequestAvailable: githubProvider?.available ?? false,
      pullRequestUnavailableReason: githubProvider?.reason ?? null,
      hasUncommittedChanges: approvalContext?.hasUncommittedChanges ?? false,
      uncommittedFileCount: approvalContext?.uncommittedFileCount ?? 0,
      pullRequestUrl: approvalContext?.pullRequest?.url ?? null,
      title: state.title,
      body: state.body,
      targetBranch: approvalContext?.targetBranch ?? null,
      publishTarget: approvalContext?.publishTarget ?? null,
      squashCommitMessage: state.squashCommitMessage,
      squashCommitMessageTouched: state.squashCommitMessageTouched,
      hasSuggestedSquashCommitMessage: approvalContext?.suggestedSquashCommitMessage != null,
      isSubmitting: state.phase === "submitting",
      errorMessage: state.errorMessage,
      onOpenChange: (open) => {
        if (!open) {
          reset();
        }
      },
      onModeChange: (mode) => dispatch({ type: "set_mode", mode }),
      onMergeMethodChange: (mergeMethod) => dispatch({ type: "set_merge_method", mergeMethod }),
      onPullRequestDraftModeChange: (pullRequestDraftMode) =>
        dispatch({ type: "set_pull_request_draft_mode", pullRequestDraftMode }),
      onTitleChange: (title) => dispatch({ type: "set_title", title }),
      onBodyChange: (body) => dispatch({ type: "set_body", body }),
      onSquashCommitMessageChange: (squashCommitMessage) =>
        dispatch({ type: "set_squash_commit_message", squashCommitMessage }),
      onConfirm: confirm,
      onSkipDirectMergeCompletion: reset,
      onCompleteDirectMerge: completeDirectMerge,
    },
    taskGitConflictDialog,
    openTaskApproval,
  };
}

import type { TaskApprovalContext, TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { canonicalTargetBranch, checkoutTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/shared/host";
import {
  invalidateTaskApprovalContextQuery,
  loadTaskApprovalContextFromQuery,
  taskApprovalQueryKeys,
} from "@/state/queries/task-approval";
import type { TaskApprovalModalModel } from "./kanban-page-model-types";

type ApprovalState = {
  open: boolean;
  stage: "approval" | "complete_direct_merge";
  taskId: string;
  isLoading: boolean;
  mode: "direct_merge" | "pull_request";
  mergeMethod: "merge_commit" | "squash" | "rebase";
  pullRequestDraftMode: "manual" | "generate_ai";
  title: string;
  body: string;
  squashCommitMessage: string;
  squashCommitMessageTouched: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  approvalContext: TaskApprovalContext | null;
};

type UseTaskApprovalFlowArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  requestPullRequestGeneration: (taskId: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  onResolveGitConflict?: (conflict: GitConflict, taskId: string) => Promise<boolean>;
};

const INITIAL_STATE: ApprovalState | null = null;
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

const resolveApprovalStage = (
  approvalContext: TaskApprovalContext | null,
): ApprovalState["stage"] => (approvalContext?.directMerge ? "complete_direct_merge" : "approval");

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
  const [state, setState] = useState<ApprovalState | null>(INITIAL_STATE);
  const [gitConflictState, setGitConflictState] = useState(INITIAL_GIT_CONFLICT_STATE);
  const approvalRequestVersionRef = useRef(0);

  const reset = useCallback(() => {
    approvalRequestVersionRef.current += 1;
    setState(INITIAL_STATE);
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

      const determineDefaultMode = (
        context: TaskApprovalContext | undefined,
      ): "direct_merge" | "pull_request" => {
        const githubProvider = context?.providers?.find((entry) => entry.providerId === "github");
        return githubProvider?.available ? "pull_request" : "direct_merge";
      };

      const cachedContext = queryClient.getQueryData(
        taskApprovalQueryKeys.context(activeRepo, taskId),
      ) as TaskApprovalContext | undefined;
      const effectiveMode = options?.mode ?? determineDefaultMode(cachedContext);

      setState({
        open: true,
        stage: "approval",
        taskId,
        isLoading: true,
        mode: effectiveMode,
        mergeMethod: "merge_commit",
        pullRequestDraftMode: options?.pullRequestDraftMode ?? "manual",
        title: task?.title ?? "",
        body: task?.description ?? "",
        squashCommitMessage: "",
        squashCommitMessageTouched: false,
        isSubmitting: false,
        errorMessage: options?.errorMessage ?? null,
        approvalContext: null,
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
          const updatedEffectiveMode = options?.mode ?? determineDefaultMode(approvalContext);
          setState({
            open: true,
            stage: resolveApprovalStage(approvalContext),
            taskId,
            isLoading: false,
            mode: updatedEffectiveMode,
            mergeMethod: approvalContext.defaultMergeMethod,
            pullRequestDraftMode: options?.pullRequestDraftMode ?? "manual",
            title: task?.title ?? "",
            body: task?.description ?? "",
            squashCommitMessage: approvalContext.suggestedSquashCommitMessage ?? "",
            squashCommitMessageTouched: false,
            isSubmitting: false,
            errorMessage: options?.errorMessage ?? null,
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
    if (!state || !activeRepo || state.isLoading || !state.approvalContext) {
      return;
    }
    const approvalContext = state.approvalContext;

    void (async () => {
      setState((current) => (current ? { ...current, isSubmitting: true } : current));
      try {
        if (state.mode === "direct_merge") {
          const directMergeResult = await host.taskDirectMerge(activeRepo, state.taskId, {
            mergeMethod: state.mergeMethod,
            squashCommitMessage:
              state.mergeMethod === "squash"
                ? state.squashCommitMessage.trim() || undefined
                : undefined,
          });
          if (directMergeResult.outcome === "conflicts") {
            reset();
            setGitConflictState({
              open: true,
              taskId: state.taskId,
              conflict: {
                ...directMergeResult.conflict,
                currentBranch: directMergeResult.conflict.currentBranch ?? null,
                workingDir: directMergeResult.conflict.workingDir ?? null,
              },
              isHandlingConflict: false,
              conflictAction: null,
            });
            return;
          }
          const mergedTask = directMergeResult.task;
          await refreshTasks();
          if (mergedTask.status === "closed") {
            toast.success("Task approved", {
              description: canonicalTargetBranch(approvalContext.targetBranch),
            });
            reset();
            return;
          }

          await invalidateTaskApprovalContextQuery(queryClient, activeRepo, state.taskId);
          const nextApprovalContext = await loadTaskApprovalContextFromQuery(
            queryClient,
            activeRepo,
            state.taskId,
          );
          if (!nextApprovalContext.directMerge) {
            throw new Error(
              "Local direct merge completed, but the task did not enter a resumable completion state.",
            );
          }

          setState((current) =>
            current
              ? {
                  ...current,
                  stage: "complete_direct_merge",
                  isSubmitting: false,
                  approvalContext: nextApprovalContext,
                  errorMessage: null,
                }
              : current,
          );
          return;
        }

        if (state.pullRequestDraftMode === "generate_ai") {
          await requestPullRequestGeneration(state.taskId);
          reset();
          return;
        } else {
          const pullRequest = await host.taskPullRequestUpsert(
            activeRepo,
            state.taskId,
            state.title,
            state.body,
          );
          toast.success("Pull request created", {
            description: `PR #${pullRequest.number}`,
            action: {
              label: "Open",
              onClick: () => {
                void openExternalUrl(pullRequest.url).catch((error) => {
                  toast.error("Failed to open pull request", {
                    description: errorMessage(error),
                  });
                });
              },
            },
          });
        }

        await refreshTasks();
        reset();
      } catch (error) {
        setState((current) => (current ? { ...current, isSubmitting: false } : current));
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
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        isHandlingConflict: true,
        conflictAction: "abort",
      }));
      try {
        await host.gitAbortConflict(
          activeRepo,
          conflict.operation,
          conflict.workingDir ?? undefined,
        );
        toast.success(getGitConflictCopy(conflict.operation).abortedToastTitle);
        closeGitConflict();
        if (gitConflictState.taskId) {
          openTaskApproval(gitConflictState.taskId, {
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
        const wasHandled = await onResolveGitConflict(conflict, taskId);
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
    if (!state || !activeRepo || !state.approvalContext) {
      return;
    }

    const approvalContext = state.approvalContext;
    const publishTarget = approvalContext.publishTarget;
    void (async () => {
      setState((current) =>
        current ? { ...current, isSubmitting: true, errorMessage: null } : current,
      );
      try {
        if (publishTarget) {
          if (!publishTarget.remote) {
            throw new Error("The configured target branch does not have a publish remote.");
          }
          const result = await host.gitPushBranch(activeRepo, checkoutTargetBranch(publishTarget), {
            remote: publishTarget.remote,
          });
          if (result.outcome !== "pushed") {
            throw new Error(result.output);
          }
        }
        await host.taskDirectMergeComplete(activeRepo, state.taskId);
        await refreshTasks();
        toast.success("Task moved to Done", {
          description: publishTarget
            ? canonicalTargetBranch(publishTarget)
            : canonicalTargetBranch(approvalContext.targetBranch),
        });
        reset();
      } catch (error) {
        const description = errorMessage(error);
        setState((current) =>
          current ? { ...current, isSubmitting: false, errorMessage: description } : current,
        );
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

  if (!state) {
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
      open: state.open,
      stage: state.stage,
      taskId: state.taskId,
      isLoading: state.isLoading,
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
      isSubmitting: state.isSubmitting,
      errorMessage: state.errorMessage,
      onOpenChange: (open) => {
        if (!open) {
          reset();
        }
      },
      onModeChange: (mode) =>
        setState((current) => (current ? { ...current, mode, errorMessage: null } : current)),
      onMergeMethodChange: (mergeMethod) =>
        setState((current) =>
          current ? { ...current, mergeMethod, errorMessage: null } : current,
        ),
      onPullRequestDraftModeChange: (pullRequestDraftMode) =>
        setState((current) =>
          current ? { ...current, pullRequestDraftMode, errorMessage: null } : current,
        ),
      onTitleChange: (title) =>
        setState((current) => (current ? { ...current, title, errorMessage: null } : current)),
      onBodyChange: (body) =>
        setState((current) => (current ? { ...current, body, errorMessage: null } : current)),
      onSquashCommitMessageChange: (squashCommitMessage) =>
        setState((current) =>
          current
            ? {
                ...current,
                squashCommitMessage,
                squashCommitMessageTouched: true,
                errorMessage: null,
              }
            : current,
        ),
      onConfirm: confirm,
      onSkipDirectMergeCompletion: reset,
      onCompleteDirectMerge: completeDirectMerge,
    },
    taskGitConflictDialog,
    openTaskApproval,
  };
}

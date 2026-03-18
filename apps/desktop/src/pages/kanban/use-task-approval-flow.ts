import type { TaskApprovalContext, TaskCard } from "@openducktor/contracts";
import { buildAgentMessagePrompt } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { canonicalTargetBranch, checkoutTargetBranch } from "@/lib/target-branch";
import { pickLatestSession } from "@/state/operations/agent-orchestrator/handlers/start-session-support";
import { host } from "@/state/operations/host";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import {
  loadPlanDocumentFromQuery,
  loadQaReportDocumentFromQuery,
  loadSpecDocumentFromQuery,
} from "@/state/queries/documents";
import {
  invalidateTaskApprovalContextQuery,
  loadTaskApprovalContextFromQuery,
} from "@/state/queries/task-approval";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
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
  sessions: AgentSessionState[];
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  forkAgentSession: (input: { parentSessionId: string }) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
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

const parseGeneratedPullRequest = (content: string): { title: string; body: string } => {
  const trimmed = content.trim();
  const titlePrefix = "Title:";
  const descriptionPrefix = "Description:";
  const titleIndex = trimmed.indexOf(titlePrefix);
  const descriptionIndex = trimmed.indexOf(descriptionPrefix);
  if (titleIndex !== 0 || descriptionIndex < 0) {
    throw new Error("Generated pull request response did not match the expected format.");
  }

  const title = trimmed.slice(titlePrefix.length, descriptionIndex).trim();
  const body = trimmed.slice(descriptionIndex + descriptionPrefix.length).trim();
  if (!title || !body) {
    throw new Error("Generated pull request response is missing the title or description.");
  }

  return { title, body };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveApprovalStage = (
  approvalContext: TaskApprovalContext | null,
): ApprovalState["stage"] => (approvalContext?.directMerge ? "complete_direct_merge" : "approval");

export function useTaskApprovalFlow({
  activeRepo,
  tasks,
  sessions,
  loadAgentSessions,
  forkAgentSession,
  sendAgentMessage,
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
  const sessionsRef = useRef(sessions);
  const approvalRequestVersionRef = useRef(0);

  sessionsRef.current = sessions;

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
      setState({
        open: true,
        stage: "approval",
        taskId,
        isLoading: true,
        mode: options?.mode ?? "direct_merge",
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
          setState({
            open: true,
            stage: resolveApprovalStage(approvalContext),
            taskId,
            isLoading: false,
            mode: options?.mode ?? "direct_merge",
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

  const waitForLoadedParentSession = useCallback(
    async (taskId: string, sessionId: string): Promise<AgentSessionState> => {
      await loadAgentSessions(taskId, {
        hydrateHistoryForSessionId: sessionId,
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const parentSession = sessionsRef.current.find((entry) => entry.sessionId === sessionId);
        if (
          parentSession &&
          parentSession.runtimeEndpoint.trim().length > 0 &&
          parentSession.workingDirectory.trim().length > 0
        ) {
          return parentSession;
        }
        await delay(50);
      }
      throw new Error("Failed to reconnect the parent Builder session for pull request drafting.");
    },
    [loadAgentSessions],
  );

  const waitForForkedAssistantReply = useCallback(
    async (sessionId: string, baselineAssistantCount: number): Promise<string> => {
      const isSettledSessionStatus = (status: AgentSessionState["status"]): boolean =>
        status === "idle" || status === "stopped";

      for (let attempt = 0; attempt < 240; attempt += 1) {
        const session = sessionsRef.current.find((entry) => entry.sessionId === sessionId);
        if (!session) {
          throw new Error(
            "Forked Builder session disappeared before the pull request draft completed.",
          );
        }
        if (session.status === "error") {
          throw new Error(
            "The forked Builder session failed while generating the pull request draft.",
          );
        }

        const assistantMessages = session.messages.filter(
          (message) => message.role === "assistant",
        );
        if (
          assistantMessages.length > baselineAssistantCount &&
          isSettledSessionStatus(session.status)
        ) {
          return assistantMessages.at(-1)?.content ?? "";
        }

        await delay(500);
      }

      throw new Error(
        "Timed out while waiting for the forked Builder session to generate the pull request draft.",
      );
    },
    [],
  );

  const createPullRequestWithAi = useCallback(
    async (currentState: ApprovalState) => {
      if (!activeRepo) {
        throw new Error("No active repository selected.");
      }

      const latestBuilderRecord = pickLatestSession(
        (await loadAgentSessionListFromQuery(queryClient, activeRepo, currentState.taskId)).filter(
          (entry) => entry.role === "build",
        ),
      );
      if (!latestBuilderRecord) {
        throw new Error("No Builder session is available to fork for pull request drafting.");
      }

      const parentSession = await waitForLoadedParentSession(
        currentState.taskId,
        latestBuilderRecord.sessionId,
      );
      const [task, overrides, spec, plan, qa] = await Promise.all([
        Promise.resolve(tasks.find((entry) => entry.id === currentState.taskId) ?? null),
        loadEffectivePromptOverrides(activeRepo, queryClient),
        loadSpecDocumentFromQuery(queryClient, activeRepo, currentState.taskId),
        loadPlanDocumentFromQuery(queryClient, activeRepo, currentState.taskId),
        loadQaReportDocumentFromQuery(queryClient, activeRepo, currentState.taskId),
      ]);
      if (!task) {
        throw new Error(`Task not found: ${currentState.taskId}`);
      }

      const baselineAssistantCount = parentSession.messages.filter(
        (message) => message.role === "assistant",
      ).length;
      const forkedSessionId = await forkAgentSession({
        parentSessionId: parentSession.sessionId,
      });
      const prompt = buildAgentMessagePrompt({
        role: "build",
        templateId: "message.build_pull_request_draft",
        task: {
          taskId: task.id,
          title: task.title,
          issueType: task.issueType,
          status: task.status,
          qaRequired: task.aiReviewEnabled,
          description: task.description,
          specMarkdown: spec.markdown,
          planMarkdown: plan.markdown,
          latestQaReportMarkdown: qa.markdown,
        },
        overrides,
      });

      await sendAgentMessage(forkedSessionId, prompt);
      const generated = parseGeneratedPullRequest(
        await waitForForkedAssistantReply(forkedSessionId, baselineAssistantCount),
      );
      const pullRequest = await host.taskPullRequestUpsert(
        activeRepo,
        currentState.taskId,
        generated.title,
        generated.body,
      );
      return pullRequest;
    },
    [
      activeRepo,
      forkAgentSession,
      queryClient,
      sendAgentMessage,
      tasks,
      waitForForkedAssistantReply,
      waitForLoadedParentSession,
    ],
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
          const reopenOptions = {
            mode: "pull_request" as const,
            pullRequestDraftMode: "generate_ai" as const,
          };
          const loadingToastId = toast.loading("Generating pull request", {
            description:
              "OpenDucktor is drafting the title and description. This can take some time.",
          });
          reset();
          void (async () => {
            try {
              const pullRequest = await createPullRequestWithAi(state);
              await refreshTasks();
              toast.success("Pull request created", {
                id: loadingToastId,
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
            } catch (error) {
              const description = errorMessage(error);
              toast.error("Pull request generation failed", {
                id: loadingToastId,
                description,
                action: {
                  label: "Reopen",
                  onClick: () => {
                    openTaskApproval(state.taskId, {
                      ...reopenOptions,
                      errorMessage: description,
                    });
                  },
                },
              });
            }
          })();
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
  }, [
    activeRepo,
    createPullRequestWithAi,
    openTaskApproval,
    queryClient,
    refreshTasks,
    reset,
    state,
  ]);

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

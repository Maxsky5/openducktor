import type { InlineCommentOwner } from "@/types/inline-comment-owner";
import type { RepositoryGitProviderContext, SystemOpenInToolId } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type {
  TaskExecutionFileSelectionResult,
  TaskExecutionSelectedFile,
} from "@/components/features/agents";
import { useGitCommentDraftValidation } from "@/components/features/agents/agent-studio-git-panel/use-git-comment-draft-validation";
import { useSessionComparisonControl } from "@/features/agent-studio-git/use-session-comparison";
import type { BuildToolsSelectedView } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import type { AgentStudioBuildToolsWorktreeSnapshot } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { pullRequestHealthError } from "@/lib/git-provider-health";
import { gitRefreshPriority } from "@/lib/git-refresh-priority";
import { hostClient } from "@/lib/host-client";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState } from "@/state";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  type PullRequestReviewContextQueryInput,
  prefetchPullRequestReviewContextFromQuery,
} from "@/state/queries/pull-request-review";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { buildTaskExecutionPanelModel } from "./use-agent-studio-right-panel";
import type { AgentsPageBuildTools } from "../shell/use-agents-page-build-tools";

export type UseAgentsPageRightPanelModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  /** The page shell owns the git state, so the chat header can read the same git conflict. */
  buildTools: AgentsPageBuildTools;
  selectedView: BuildToolsSelectedView;
  tabs: Parameters<typeof buildTaskExecutionPanelModel>[0]["tabs"];
  activeTabId: Parameters<typeof buildTaskExecutionPanelModel>[0]["activeTabId"];
  onActiveTabChange: Parameters<typeof buildTaskExecutionPanelModel>[0]["onActiveTabChange"];
  isPanelOpen: boolean;
  pullRequestReviewUnavailableReason: string | null;
  documentsModel: Parameters<typeof buildTaskExecutionPanelModel>[0]["documentModel"];
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => TaskExecutionFileSelectionResult;
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
};

type BuildAgentsPageDiffModelSnapshot = Pick<
  AgentStudioBuildToolsWorktreeSnapshot,
  "diffData" | "gitPanelContextMode" | "openInTarget" | "resolvedGitPanelBranch"
>;

type BuildAgentsPageDiffModelArgs<GitActions extends object> = {
  subjectKey: string;
  buildToolsSnapshot: BuildAgentsPageDiffModelSnapshot;
  gitActions: GitActions;
  selectedTask: BuildToolsSelectedView["selectedTask"];
  commentOwner?: InlineCommentOwner | null;
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  openDirectoryInTool?: (path: string, toolId: SystemOpenInToolId) => Promise<void>;
};

type BuildAgentsPageDiffOptionalModel = {
  openDirectoryInTool?: (toolId: SystemOpenInToolId) => Promise<void>;
  isDetectingPullRequest?: true;
  onDetectPullRequest?: () => void;
  detectPullRequestDisabledReason?: string;
};

type FileExplorerRoot = {
  rootPath: string | null;
  unavailableReason: string | null;
};

/** Identifies the task and session that the git panel shows. */
function toGitPanelSubjectKey({
  workspaceId,
  taskId,
  sessionIdentity,
}: {
  workspaceId: string | null;
  taskId: string;
  sessionIdentity: Pick<AgentSessionIdentity, "runtimeKind" | "externalSessionId"> | null;
}): string {
  return JSON.stringify([
    workspaceId,
    taskId,
    sessionIdentity ? [sessionIdentity.runtimeKind, sessionIdentity.externalSessionId] : null,
  ]);
}

export function buildAgentsPageDiffModel<GitActions extends object>({
  subjectKey,
  buildToolsSnapshot,
  gitActions,
  selectedTask,
  commentOwner = null,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
  openDirectoryInTool = hostClient.systemOpenDirectoryInTool,
}: BuildAgentsPageDiffModelArgs<GitActions>) {
  const { diffData, gitPanelContextMode, openInTarget, resolvedGitPanelBranch } =
    buildToolsSnapshot;
  const readFailedWithoutContext = gitProviderContext == null && gitProviderReadError != null;
  const pullRequestDetectionTask =
    (gitProviderContext?.descriptor.capabilities.supportsPullRequests === true ||
      readFailedWithoutContext) &&
    selectedTask &&
    !selectedTask.pullRequest &&
    canDetectTaskPullRequest(selectedTask)
      ? selectedTask
      : null;
  const detectPullRequestDisabledReason =
    gitProviderReadError ?? pullRequestHealthError(gitProviderContext);
  const openInTargetPath = openInTarget.path;
  const optionalModel: BuildAgentsPageDiffOptionalModel = {};
  if (openInTargetPath) {
    optionalModel.openDirectoryInTool = (toolId) => openDirectoryInTool(openInTargetPath, toolId);
  }
  if (selectedTask && detectingPullRequestTaskId === selectedTask.id) {
    optionalModel.isDetectingPullRequest = true;
  }
  if (pullRequestDetectionTask) {
    optionalModel.onDetectPullRequest = () => onDetectPullRequest(pullRequestDetectionTask.id);
    if (detectPullRequestDisabledReason) {
      optionalModel.detectPullRequestDisabledReason = detectPullRequestDisabledReason;
    }
  }

  return {
    ...diffData,
    subjectKey,
    contextMode: gitPanelContextMode,
    commentOwner,
    branch: resolvedGitPanelBranch,
    openInTargetPath: openInTarget.path,
    openInDisabledReason: openInTarget.disabledReason,
    pullRequest: selectedTask?.pullRequest ?? null,
    ...gitActions,
    ...optionalModel,
  };
}

export const resolveTaskExecutionFileExplorerRoot = ({
  workspaceRepoPath,
  contextMode,
  worktreePath,
  isWorktreeResolving,
  worktreeError,
}: {
  workspaceRepoPath: string | null;
  contextMode: AgentStudioBuildToolsWorktreeSnapshot["gitPanelContextMode"];
  worktreePath: string | null;
  isWorktreeResolving: boolean;
  worktreeError: string | null;
}): FileExplorerRoot => {
  if (contextMode === "worktree") {
    if (worktreePath) {
      return { rootPath: worktreePath, unavailableReason: null };
    }
    if (isWorktreeResolving) {
      return { rootPath: null, unavailableReason: "Resolving task worktree..." };
    }
    return {
      rootPath: null,
      unavailableReason: worktreeError ?? "Task worktree is unavailable.",
    };
  }

  if (workspaceRepoPath) {
    return {
      rootPath: workspaceRepoPath,
      unavailableReason: null,
    };
  }

  return {
    rootPath: null,
    unavailableReason: "No repository is selected.",
  };
};

export const resolveTaskExecutionFileExplorerTargetBranch = ({
  contextMode,
  targetBranch,
  upstreamStatus,
  hasLoadedRepositoryStatus,
  targetBranchValidationError,
}: {
  contextMode: AgentStudioBuildToolsWorktreeSnapshot["gitPanelContextMode"];
  targetBranch: string | null;
  upstreamStatus: AgentStudioBuildToolsWorktreeSnapshot["diffData"]["upstreamStatus"];
  hasLoadedRepositoryStatus: boolean;
  targetBranchValidationError: string | null;
}): string | null => {
  if (contextMode === "worktree" && targetBranchValidationError) {
    return null;
  }
  if (contextMode === "repository") {
    if (!hasLoadedRepositoryStatus || upstreamStatus !== "tracking") {
      return null;
    }
  }
  return targetBranch;
};

export function useAgentsPageRightPanelModel({
  activeWorkspace,
  buildTools,
  selectedView,
  tabs,
  activeTabId,
  onActiveTabChange,
  isPanelOpen,
  pullRequestReviewUnavailableReason,
  documentsModel,
  selectedFile,
  onSelectFile,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
}: UseAgentsPageRightPanelModelArgs) {
  const queryClient = useQueryClient();
  const taskTargetControl = useSessionComparisonControl({
    repoPath: activeWorkspace?.repoPath ?? "__no_repo__",
    target: buildTools.buildToolsSnapshot.comparison?.target ?? null,
    editable:
      buildTools.buildToolsSnapshot.gitPanelContextMode === "worktree" &&
      !!setTaskTargetBranch &&
      !!selectedView.selectedTask,
    applyTarget: async (target) => {
      if (!setTaskTargetBranch || !selectedView.selectedTask)
        throw new Error("The task target is unavailable. Select the task again.");
      await setTaskTargetBranch(selectedView.selectedTask.id, target);
    },
  });
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { buildToolsSnapshot, gitActions } = buildTools;
  const { diffData } = buildToolsSnapshot;
  const { refreshWorktree: refreshBuildToolsWorktree } = buildToolsSnapshot;
  const commentOwner = useMemo(
    () =>
      activeWorkspace
        ? {
            kind: "task" as const,
            workspaceId: activeWorkspace.workspaceId,
            taskId: selectedView.taskId,
          }
        : null,
    [activeWorkspace, selectedView.taskId],
  );
  const gitPanelSubjectKey = toGitPanelSubjectKey({
    workspaceId: activeWorkspace?.workspaceId ?? null,
    taskId: selectedView.taskId,
    sessionIdentity: selectedView.selectedSession.identity,
  });
  const fileExplorerRoot = useMemo(
    () =>
      resolveTaskExecutionFileExplorerRoot({
        workspaceRepoPath,
        contextMode: buildToolsSnapshot.gitPanelContextMode,
        worktreePath: buildToolsSnapshot.worktree.path,
        isWorktreeResolving: buildToolsSnapshot.worktree.isResolving,
        worktreeError: buildToolsSnapshot.worktree.error,
      }),
    [
      buildToolsSnapshot.gitPanelContextMode,
      buildToolsSnapshot.worktree.error,
      buildToolsSnapshot.worktree.isResolving,
      buildToolsSnapshot.worktree.path,
      workspaceRepoPath,
    ],
  );
  const fileExplorerTargetBranch = resolveTaskExecutionFileExplorerTargetBranch({
    contextMode: buildToolsSnapshot.gitPanelContextMode,
    targetBranch: diffData.comparisonReference ?? null,
    upstreamStatus: diffData.upstreamStatus,
    hasLoadedRepositoryStatus: diffData.loadedScopesByScope[diffData.diffScope],
    targetBranchValidationError: buildToolsSnapshot.targetBranchState.validationError,
  });
  const fileExplorerBranchKey = buildToolsSnapshot.repositoryBranchIdentityKey?.startsWith(
    "detached:",
  )
    ? buildToolsSnapshot.repositoryBranchIdentityKey
    : (buildToolsSnapshot.resolvedGitPanelBranch ?? "__unknown_branch__");
  const fileExplorerModel = useMemo(
    () => ({
      ...fileExplorerRoot,
      targetBranch: fileExplorerTargetBranch,
      branchKey: fileExplorerBranchKey,
      isActive: activeTabId === "file_explorer" && isPanelOpen,
      selectedFile,
      onSelectFile,
    }),
    [
      activeTabId,
      fileExplorerRoot,
      fileExplorerTargetBranch,
      fileExplorerBranchKey,
      isPanelOpen,
      onSelectFile,
      selectedFile,
    ],
  );
  const hasCiChecksTab = tabs.some((tab) => tab.id === "ci_checks");
  const linkedPullRequestProviderId = selectedView.selectedTask?.pullRequest?.providerId ?? null;
  const linkedPullRequestNumber = selectedView.selectedTask?.pullRequest?.number ?? null;
  const ciReviewQueryInput = useMemo<PullRequestReviewContextQueryInput | null>(
    () =>
      workspaceRepoPath &&
      selectedView.taskId &&
      linkedPullRequestProviderId &&
      linkedPullRequestNumber &&
      pullRequestReviewUnavailableReason === null
        ? {
            repoPath: workspaceRepoPath,
            taskId: selectedView.taskId,
            pullRequest: {
              providerId: linkedPullRequestProviderId,
              number: linkedPullRequestNumber,
            },
          }
        : null,
    [
      linkedPullRequestNumber,
      linkedPullRequestProviderId,
      pullRequestReviewUnavailableReason,
      selectedView.taskId,
      workspaceRepoPath,
    ],
  );
  const hasLinkedPullRequest =
    linkedPullRequestProviderId !== null && linkedPullRequestNumber !== null;
  useEffect(() => {
    if (!hasCiChecksTab || !hasLinkedPullRequest || !ciReviewQueryInput) {
      return;
    }

    void prefetchPullRequestReviewContextFromQuery(queryClient, ciReviewQueryInput);
  }, [ciReviewQueryInput, hasCiChecksTab, hasLinkedPullRequest, queryClient]);

  const ciChecksModel = useMemo(
    () =>
      hasCiChecksTab
        ? {
            isActive: activeTabId === "ci_checks" && isPanelOpen,
            queryInput: ciReviewQueryInput,
            unavailableReason: pullRequestReviewUnavailableReason,
          }
        : null,
    [
      activeTabId,
      ciReviewQueryInput,
      hasCiChecksTab,
      isPanelOpen,
      pullRequestReviewUnavailableReason,
    ],
  );
  const refreshWorktree = useCallback<GitDiffRefresh>(
    async (mode): Promise<void> => {
      const fileQueryRoots = new Set(
        [fileExplorerRoot.rootPath, selectedFile?.rootPath ?? null].filter(
          (rootPath): rootPath is string => rootPath !== null,
        ),
      );
      const refreshGit = () => refreshBuildToolsWorktree(mode);
      if (fileQueryRoots.size === 0) {
        await refreshGit();
        return;
      }
      await Promise.all(
        [...fileQueryRoots].map((rootPath, index) =>
          refreshWorkspaceFileQueries(
            queryClient,
            rootPath,
            mode === "soft" || mode === "scheduled" ? "incremental" : "full",
            index === 0
              ? {
                  consumer: refreshBuildToolsWorktree,
                  context: JSON.stringify([
                    workspaceRepoPath,
                    selectedView.taskId,
                    diffData.worktreePath,
                    diffData.targetBranch,
                    diffData.diffScope,
                    fileExplorerBranchKey,
                  ]),
                  priority: gitRefreshPriority(mode ?? "hard"),
                  mayFetch: mode !== "soft",
                  run: refreshGit,
                }
              : undefined,
          ),
        ),
      );
    },
    [
      fileExplorerRoot.rootPath,
      queryClient,
      refreshBuildToolsWorktree,
      selectedFile,
      workspaceRepoPath,
      selectedView.taskId,
      diffData.worktreePath,
      diffData.targetBranch,
      diffData.diffScope,
      fileExplorerBranchKey,
    ],
  );

  const diffModel = useMemo(() => {
    const input: BuildAgentsPageDiffModelArgs<typeof gitActions> = {
      subjectKey: gitPanelSubjectKey,
      buildToolsSnapshot,
      gitActions,
      selectedTask: selectedView.selectedTask,
      commentOwner,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      gitProviderContext,
      gitProviderReadError,
    };
    return {
      ...buildAgentsPageDiffModel(input),
      ...taskTargetControl,
      rebaseOntoTarget: diffData.comparisonReference ? gitActions.rebaseOntoTarget : undefined,
      refresh: refreshWorktree,
    };
  }, [
    buildToolsSnapshot,
    diffData.comparisonReference,
    taskTargetControl,
    refreshWorktree,
    commentOwner,
    gitActions,
    onDetectPullRequest,
    gitProviderContext,
    gitProviderReadError,
    gitPanelSubjectKey,
    detectingPullRequestTaskId,
    selectedView.selectedTask,
  ]);
  useGitCommentDraftValidation(diffModel);

  const rightPanelModel = useMemo(
    () =>
      buildTaskExecutionPanelModel({
        tabs,
        activeTabId,
        documentModel: documentsModel,
        diffModel,
        fileExplorerModel,
        ciChecksModel,
        onActiveTabChange,
      }),
    [
      activeTabId,
      ciChecksModel,
      diffModel,
      documentsModel,
      fileExplorerModel,
      onActiveTabChange,
      tabs,
    ],
  );

  return {
    isRightPanelVisible: Boolean(activeTabId && isPanelOpen),
    rightPanelModel,
    refreshWorktree,
  };
}

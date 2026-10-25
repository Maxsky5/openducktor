import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import type {
  GitTargetBranch,
  RepositoryGitProviderContext,
  SystemOpenInToolId,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type {
  TaskExecutionDocumentPanelModel,
  TaskExecutionFileSelectionResult,
  TaskExecutionSelectedFile,
  TaskExecutionToolsModel,
} from "@/components/features/agents";
import { useGitCommentDraftValidation } from "@openducktor/frontend-core/git/use-git-comment-draft-validation";
import {
  resolveTaskExecutionFileExplorerRoot,
  resolveTaskExecutionFileExplorerTargetBranch,
} from "@openducktor/frontend-core/git/task/task-worktree-paths";
import { useSessionComparisonControl } from "@/features/agent-studio-git/use-session-comparison-control";
import type { BuildToolsSelectedView } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import type { AgentStudioBuildToolsWorktreeSnapshot } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import type { GitDiffRefresh } from "@openducktor/frontend-core/git/contracts";
import { withFileQueries } from "@openducktor/frontend-core/git/refresh/git-file-refresh";
import type { SessionPanelModel } from "@/features/session-panels";
import { pullRequestHealthError } from "@openducktor/frontend-core/review/git-provider-health";
import { canDetectTaskPullRequest } from "@openducktor/frontend-core/tasks/presentation/task-display";
import type { useTasksState } from "@/state";
import {
  type PullRequestReviewContextQueryInput,
  prefetchPullRequestReviewContextFromQuery,
} from "@openducktor/frontend-core/queries/pull-request-review";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentsPageBuildTools } from "../shell/use-agents-page-build-tools";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";

export type UseAgentsPageRightPanelModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  /** The page shell owns the git state, so the chat header can read the same git conflict. */
  buildTools: AgentsPageBuildTools;
  selectedView: BuildToolsSelectedView;
  panel: SessionPanelModel;
  pullRequestReviewUnavailableReason: string | null;
  documentsModel: TaskExecutionDocumentPanelModel | null;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => TaskExecutionFileSelectionResult;
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskIds: ReadonlySet<string>;
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
  detectingPullRequestTaskIds: ReadonlySet<string>;
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
  detectingPullRequestTaskIds,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
  openDirectoryInTool,
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
  if (openInTargetPath && openDirectoryInTool) {
    optionalModel.openDirectoryInTool = (toolId) => openDirectoryInTool(openInTargetPath, toolId);
  }
  if (selectedTask && detectingPullRequestTaskIds.has(selectedTask.id)) {
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

export function useAgentsPageRightPanelModel({
  activeWorkspace,
  buildTools,
  selectedView,
  panel,
  pullRequestReviewUnavailableReason,
  documentsModel,
  selectedFile,
  onSelectFile,
  setTaskTargetBranch,
  detectingPullRequestTaskIds,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
}: UseAgentsPageRightPanelModelArgs) {
  const queryClient = useQueryClient();
  const hostClient = useHostClient();
  // A tool view is active while its tab is selected in the shown right panel.
  const isActive = useSessionViewActive();
  const activeKind = isActive ? panel.activeKind : null;
  const selectedTaskId = selectedView.selectedTask?.id ?? null;
  const applyTaskTarget = useCallback(
    async (target: GitTargetBranch) => {
      if (!setTaskTargetBranch || !selectedTaskId)
        throw new Error("The task target is unavailable. Select the task again.");
      await setTaskTargetBranch(selectedTaskId, target);
    },
    [selectedTaskId, setTaskTargetBranch],
  );
  const taskTargetControl = useSessionComparisonControl({
    repoPath: activeWorkspace?.repoPath ?? "__no_repo__",
    target: buildTools.buildToolsSnapshot.comparison?.target ?? null,
    editable:
      buildTools.buildToolsSnapshot.gitPanelContextMode === "worktree" &&
      !!setTaskTargetBranch &&
      !!selectedView.selectedTask,
    applyTarget: applyTaskTarget,
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
    hasLoadedRepositoryStatus: diffData.loadedScopesByScope.uncommitted,
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
      isActive: activeKind === "files",
      selectedFile,
      onSelectFile,
    }),
    [
      activeKind,
      fileExplorerRoot,
      fileExplorerTargetBranch,
      fileExplorerBranchKey,
      onSelectFile,
      selectedFile,
    ],
  );
  // The Git panel opens the same preview as the Files tab, from the same root.
  const fileRootPath = fileExplorerRoot.rootPath;
  const viewFile = useMemo(
    () =>
      fileRootPath
        ? (relativePath: string) => void onSelectFile({ rootPath: fileRootPath, relativePath })
        : null,
    [fileRootPath, onSelectFile],
  );
  const hasCiChecksTab = panel.tabs.some((tab) => tab.kind === "ci_checks");
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
    if (!isActive || !hasCiChecksTab || !hasLinkedPullRequest || !ciReviewQueryInput) {
      return;
    }

    void prefetchPullRequestReviewContextFromQuery(queryClient, ciReviewQueryInput);
  }, [isActive, ciReviewQueryInput, hasCiChecksTab, hasLinkedPullRequest, queryClient]);

  const ciChecksModel = useMemo(
    () =>
      hasCiChecksTab
        ? {
            isActive: activeKind === "ci_checks",
            queryInput: ciReviewQueryInput,
            unavailableReason: pullRequestReviewUnavailableReason,
          }
        : null,
    [activeKind, ciReviewQueryInput, hasCiChecksTab, pullRequestReviewUnavailableReason],
  );
  const fileQueryRoots = useMemo(
    () => [
      ...new Set(
        [fileExplorerRoot.rootPath, selectedFile?.rootPath ?? null].filter(
          (rootPath): rootPath is string => rootPath !== null,
        ),
      ),
    ],
    [fileExplorerRoot.rootPath, selectedFile?.rootPath],
  );
  const withFiles = useMemo(
    () =>
      withFileQueries(
        queryClient,
        fileQueryRoots,
        JSON.stringify([gitPanelSubjectKey, diffData.worktreePath, fileExplorerBranchKey]),
      ),
    [diffData.worktreePath, fileExplorerBranchKey, fileQueryRoots, gitPanelSubjectKey, queryClient],
  );
  const refreshWorktree = useCallback<GitDiffRefresh>(
    (mode) => refreshBuildToolsWorktree(mode, withFiles),
    [refreshBuildToolsWorktree, withFiles],
  );
  // Git feedback ends with the Git reads. File views show their own refresh and errors.
  const refreshManually = useCallback(
    () => refreshBuildToolsWorktree("hard", withFiles),
    [refreshBuildToolsWorktree, withFiles],
  );
  const { manualRefresh } = buildToolsSnapshot;

  const diffModel = useMemo(() => {
    const input: BuildAgentsPageDiffModelArgs<typeof gitActions> = {
      subjectKey: gitPanelSubjectKey,
      buildToolsSnapshot,
      gitActions,
      selectedTask: selectedView.selectedTask,
      commentOwner,
      detectingPullRequestTaskIds,
      onDetectPullRequest,
      gitProviderContext,
      gitProviderReadError,
      openDirectoryInTool: hostClient.systemOpenDirectoryInTool,
    };
    return {
      ...buildAgentsPageDiffModel(input),
      ...taskTargetControl,
      rebaseOntoTarget: diffData.comparisonReference ? gitActions.rebaseOntoTarget : undefined,
      refresh: refreshManually,
      isRefreshing: manualRefresh.isRefreshing,
      refreshError: manualRefresh.refreshError,
      onViewFile: viewFile,
    };
  }, [
    viewFile,
    buildToolsSnapshot,
    diffData.comparisonReference,
    taskTargetControl,
    manualRefresh.isRefreshing,
    manualRefresh.refreshError,
    refreshManually,
    commentOwner,
    gitActions,
    onDetectPullRequest,
    gitProviderContext,
    gitProviderReadError,
    gitPanelSubjectKey,
    detectingPullRequestTaskIds,
    hostClient,
    selectedView.selectedTask,
  ]);
  useGitCommentDraftValidation(diffModel);

  const toolsModel = useMemo<TaskExecutionToolsModel>(
    () => ({
      documentModel: documentsModel,
      gitModel: diffModel,
      fileExplorerModel,
      ciChecksModel,
    }),
    [ciChecksModel, diffModel, documentsModel, fileExplorerModel],
  );

  return { toolsModel, refreshWorktree };
}

import type {
  GitBranch,
  RepositoryGitProviderContext,
  SystemOpenInToolId,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type {
  TaskExecutionFileSelectionResult,
  TaskExecutionSelectedFile,
} from "@/components/features/agents";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { BuildToolsSelectedView } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import type { AgentStudioBuildToolsWorktreeSnapshot } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import type { DiffScope, GitDiffRefresh } from "@/features/agent-studio-git";
import { useAgentStudioDevServerPanel } from "@/features/dev-servers/use-agent-studio-dev-server-panel";
import { pullRequestHealthError } from "@/lib/git-provider-health";
import { gitRefreshPriority } from "@/lib/git-refresh-priority";
import { hostClient } from "@/lib/host-client";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState } from "@/state";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  type PullRequestReviewContextQueryInput,
  prefetchPullRequestReviewContextFromQuery,
} from "@/state/queries/pull-request-review";
import {
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { buildTaskExecutionPanelModel } from "./use-agent-studio-right-panel";
import type { AgentsPageBuildTools } from "../shell/use-agents-page-build-tools";

export type UseAgentsPageRightPanelModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
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
  | "diffData"
  | "gitPanelContextMode"
  | "openInTarget"
  | "resolvedGitPanelBranch"
  | "targetBranchState"
>;

type BuildAgentsPageDiffModelArgs<GitActions extends object> = {
  subjectKey: string;
  branches: GitBranch[];
  buildToolsSnapshot: BuildAgentsPageDiffModelSnapshot;
  gitActions: GitActions;
  selectedTask: BuildToolsSelectedView["selectedTask"];
  commentOwner?: { workspaceId: string; taskId: string } | null;
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  openDirectoryInTool?: (path: string, toolId: SystemOpenInToolId) => Promise<void>;
};

type BuildAgentsPageDiffOptionalModel = {
  openDirectoryInTool?: (toolId: SystemOpenInToolId) => Promise<void>;
  targetBranch?: BuildAgentsPageDiffModelSnapshot["targetBranchState"]["displayTargetBranch"];
  isDetectingPullRequest?: true;
  onDetectPullRequest?: () => void;
  detectPullRequestDisabledReason?: string;
  isGitActionsLocked?: true;
  gitActionsLockReason?: string;
  showLockReasonBanner?: true;
};

type FileExplorerRoot = {
  rootPath: string | null;
  unavailableReason: string | null;
};

const COMMENT_VALIDATION_SCOPES: readonly DiffScope[] = ["uncommitted", "target"];

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
  branches,
  buildToolsSnapshot,
  gitActions,
  selectedTask,
  commentOwner = null,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
  openDirectoryInTool = hostClient.systemOpenDirectoryInTool,
}: BuildAgentsPageDiffModelArgs<GitActions>) {
  const { diffData, gitPanelContextMode, openInTarget, resolvedGitPanelBranch, targetBranchState } =
    buildToolsSnapshot;
  const targetBranchValidationError = targetBranchState.validationError;
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
  let targetBranchUpdateModel = {};
  if (gitPanelContextMode === "worktree" && selectedTask && setTaskTargetBranch) {
    const configuredTargetBranch = canonicalTargetBranch(targetBranchState.effectiveTargetBranch);
    const targetBranchOptions = toBranchSelectorOptions(branches, {
      valueFormat: "full_ref",
      includeOptions: configuredTargetBranch
        ? [
            {
              value: targetBranchState.selectionValue,
              label: configuredTargetBranch,
              secondaryLabel: "configured",
              searchKeywords: configuredTargetBranch.split("/").filter(Boolean),
            },
          ]
        : [],
    });
    targetBranchUpdateModel = {
      targetBranchOptions,
      targetBranchSelectionValue: targetBranchState.selectionValue,
      onUpdateTargetBranch: async (selection: string) => {
        await setTaskTargetBranch(selectedTask.id, targetBranchFromSelection(selection));
      },
    };
  }

  const openInTargetPath = openInTarget.path;
  const optionalModel: BuildAgentsPageDiffOptionalModel = {};
  if (openInTargetPath) {
    optionalModel.openDirectoryInTool = (toolId) => openDirectoryInTool(openInTargetPath, toolId);
  }
  if (targetBranchValidationError) {
    optionalModel.targetBranch = targetBranchState.displayTargetBranch;
    optionalModel.isGitActionsLocked = true;
    optionalModel.gitActionsLockReason = targetBranchValidationError;
    optionalModel.showLockReasonBanner = true;
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
    ...targetBranchUpdateModel,
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
  targetBranchValidationError,
}: {
  workspaceRepoPath: string | null;
  contextMode: AgentStudioBuildToolsWorktreeSnapshot["gitPanelContextMode"];
  worktreePath: string | null;
  isWorktreeResolving: boolean;
  worktreeError: string | null;
  targetBranchValidationError: string | null;
}): FileExplorerRoot => {
  if (contextMode === "worktree") {
    if (targetBranchValidationError) {
      return { rootPath: null, unavailableReason: targetBranchValidationError };
    }
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
  if (targetBranchValidationError) {
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
  branches = [],
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
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { buildToolsSnapshot, gitActions } = buildTools;
  const { diffData } = buildToolsSnapshot;
  const { refreshWorktree: refreshBuildToolsWorktree } = buildToolsSnapshot;
  const devServerModel = useAgentStudioDevServerPanel(buildToolsSnapshot.devServerTarget);
  const commentOwner = useMemo(
    () =>
      activeWorkspace
        ? { workspaceId: activeWorkspace.workspaceId, taskId: selectedView.taskId }
        : null,
    [activeWorkspace, selectedView.taskId],
  );
  const commentOwnerKey = useMemo(
    () => (commentOwner ? toInlineCommentDraftOwnerKey(commentOwner) : null),
    [commentOwner],
  );
  const isCommentStoreHydrated = useInlineCommentDraftStore((store) => store.isHydrated);
  const dropDraftsForMissingFiles = useInlineCommentDraftStore(
    (store) => store.dropDraftsForMissingFiles,
  );

  useEffect(() => {
    if (commentOwnerKey === null || !isCommentStoreHydrated) {
      return;
    }

    for (const diffScope of COMMENT_VALIDATION_SCOPES) {
      if (!diffData.loadedScopesByScope[diffScope]) {
        continue;
      }
      const scopeState = diffData.scopeStatesByScope[diffScope];
      if (scopeState.error !== null) {
        continue;
      }
      const presentFilePaths = new Set(scopeState.fileDiffs.map((fileDiff) => fileDiff.file));
      dropDraftsForMissingFiles(commentOwnerKey, diffScope, presentFilePaths);
    }
  }, [
    commentOwnerKey,
    diffData.loadedScopesByScope,
    diffData.scopeStatesByScope,
    dropDraftsForMissingFiles,
    isCommentStoreHydrated,
  ]);

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
        targetBranchValidationError: buildToolsSnapshot.targetBranchState.validationError,
      }),
    [
      buildToolsSnapshot.gitPanelContextMode,
      buildToolsSnapshot.worktree.error,
      buildToolsSnapshot.worktree.isResolving,
      buildToolsSnapshot.worktree.path,
      buildToolsSnapshot.targetBranchState.validationError,
      workspaceRepoPath,
    ],
  );
  const fileExplorerTargetBranch = resolveTaskExecutionFileExplorerTargetBranch({
    contextMode: buildToolsSnapshot.gitPanelContextMode,
    targetBranch: diffData.targetBranch ?? null,
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
  const visibleDevServerModel = selectedView.role === "build" ? devServerModel : null;
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
      branches,
      buildToolsSnapshot,
      gitActions,
      selectedTask: selectedView.selectedTask,
      commentOwner,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      gitProviderContext,
      gitProviderReadError,
    };
    if (setTaskTargetBranch) {
      input.setTaskTargetBranch = setTaskTargetBranch;
    }
    return { ...buildAgentsPageDiffModel(input), refresh: refreshWorktree };
  }, [
    buildToolsSnapshot,
    refreshWorktree,
    branches,
    commentOwner,
    gitActions,
    onDetectPullRequest,
    gitProviderContext,
    gitProviderReadError,
    gitPanelSubjectKey,
    detectingPullRequestTaskId,
    setTaskTargetBranch,
    selectedView.selectedTask,
  ]);

  const rightPanelModel = useMemo(
    () =>
      buildTaskExecutionPanelModel({
        tabs,
        activeTabId,
        documentModel: documentsModel,
        diffModel,
        fileExplorerModel,
        ciChecksModel,
        devServerModel: visibleDevServerModel,
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
      visibleDevServerModel,
    ],
  );

  return {
    isRightPanelVisible: Boolean(activeTabId && isPanelOpen),
    rightPanelModel,
    refreshWorktree,
  };
}

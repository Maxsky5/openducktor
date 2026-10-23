import type { ResolveGitConflict } from "@/features/git-conflict-resolution/conflict-assistance";
import {
  useSessionComparison,
  useSessionComparisonControl,
} from "@/features/agent-studio-git/use-session-comparison";
import { useComparisonView } from "@/features/agent-studio-git/session-comparison-view";
import {
  type GitPanelReads,
  useGitPanelReads,
} from "@/features/agent-studio-git/reads/use-git-panel-reads";
import { withFileQueries } from "@/features/agent-studio-git/refresh/git-file-refresh";
import type { GitRefreshComparison } from "@/features/agent-studio-git/refresh/git-refresh-coordinator";
import { useGitRefresh } from "@/features/agent-studio-git/refresh/use-git-refresh";
import type { GitCurrentBranch, GitTargetBranch } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo } from "react";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import { collectUnmergedFilePaths } from "@/features/agent-studio-git";
import { canonicalTargetBranch } from "@openducktor/frontend-core/lib/target-branch";
import { checkoutReadIdentity } from "@openducktor/frontend-core/queries/git";
import type {
  TaskExecutionFileExplorerPanelModel,
  TaskExecutionSelectedFile,
} from "./task-execution-file-explorer-model";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";
import { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { WorkspaceSessionGitTools } from "./workspace-session-git-tools";
import { useGitCommentDraftValidation } from "./agent-studio-git-panel/use-git-comment-draft-validation";

const missingWorkingDirectoryReason = "The selected working directory is unavailable.";

type WorkspaceSessionToolsProps = {
  isVisible: boolean;
  onResolveGitConflict?: ResolveGitConflict;
  conflictAssistanceBlockedReason?: string | null;
  conflictAssistanceIsStarting?: boolean;
  repoPath: string;
  workspaceId: string;
  sessionId: string;
  workingDirectory: string | null;
  contextMode: "repository" | "worktree";
  branchKey: string;
  currentBranch: GitCurrentBranch | null;
  branchReady: boolean;
  branchError?: string | null;
  target: GitTargetBranch | null;
  /**
   * The saved target of this session, or null when it follows the repository default. Each saved
   * target has its own Refresh, so loading the default settings keeps the running Refresh.
   */
  savedTarget: GitTargetBranch | null;
  targetError: string | null;
  applyTarget: (target: GitTargetBranch) => Promise<void>;
  retryTarget: () => Promise<void>;
  readBranch: () => Promise<string>;
  /** True while the Files tab is selected in the shown right panel. */
  isFilesActive: boolean;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
  /** Replaces the read-only repository branch label for a repository-root session. */
  repositoryBranchControl?: ReactNode;
};

/** The session shell owns this hook even when the tools view unmounts. */
export function useWorkspaceSessionTools({
  isVisible,
  onResolveGitConflict,
  conflictAssistanceBlockedReason,
  conflictAssistanceIsStarting,
  repoPath,
  workspaceId,
  sessionId,
  workingDirectory,
  contextMode,
  branchKey,
  currentBranch,
  branchReady,
  branchError,
  applyTarget,
  target,
  savedTarget,
  targetError,
  retryTarget,
  readBranch,
  isFilesActive,
  selectedFile,
  onSelectFile,
  repositoryBranchControl,
}: WorkspaceSessionToolsProps) {
  const sessionKey = JSON.stringify([workspaceId, sessionId]);
  const commentOwner = useMemo<Extract<InlineCommentOwner, { kind: "workspace_session" }>>(
    () => ({ kind: "workspace_session", workspaceId, sessionId }),
    [workspaceId, sessionId],
  );
  const checkoutIdentity = checkoutReadIdentity(currentBranch);
  const comparison = useSessionComparison({
    enabled: isVisible,
    viewKey: sessionKey,
    repoPath,
    workingDirectory,
    target,
    targetError,
    branchKey,
    checkoutIdentity,
    branchReady,
    branchError: branchError ?? null,
  });
  const control = useSessionComparisonControl({
    repoPath,
    target,
    editable: isVisible,
    allowUpstream: contextMode === "repository",
    applyTarget,
    helpText: "This choice applies only to this chat. The chat saves it.",
  });
  const readsRepoPath = workingDirectory ? repoPath : null;
  const reads = useGitPanelReads({
    repoPath: readsRepoPath,
    workingDir: workingDirectory,
    comparisonReference: comparison.resolvedTarget,
    cacheKey: comparison.cacheKey,
    checkoutIdentity,
    enabled: isVisible && workingDirectory !== null && branchReady,
  });
  const diffData = useComparisonView(reads, comparison, {
    repoPath: readsRepoPath,
    worktreePath: workingDirectory,
    label: target ? canonicalTargetBranch(target) : "Default target pending",
    checkout: currentBranch,
  });
  const unavailableReason = diffData.comparisonUnavailableReason ?? null;
  const markerTarget = diffData.comparisonReference ?? null;
  // An in-flight diff can finish after the tools view closes.
  useGitCommentDraftValidation({
    commentOwner,
    targetBranch: comparison.resolvedTarget,
    comparisonUnavailableReason: unavailableReason,
    scopeStatesByScope: diffData.scopeStatesByScope,
    loadedScopesByScope: diffData.loadedScopesByScope,
  });
  const gitRefresh = useWorkspaceGitRefresh({
    sessionKey,
    repoPath,
    workingDirectory,
    savedTarget,
    branchKey,
    visible: isVisible,
    ready: branchReady,
    prepare: targetError ? retryTarget : null,
    readBranch,
    comparison: comparison.refreshStep,
    reads,
  });
  const conflictedFiles = useMemo(
    () => collectUnmergedFilePaths(diffData.fileStatuses),
    [diffData.fileStatuses],
  );
  const actions = useAgentStudioGitActions({
    onResolveGitConflict,
    assistanceContextKey: sessionKey,
    conflictRecipientLabel: "agent",
    conflictAssistanceBlockedReason,
    conflictAssistanceIsStarting,
    repoPath: readsRepoPath,
    workingDir: workingDirectory,
    branch: branchReady ? diffData.branch : null,
    contextKey: comparison.contextKey,
    targetBranch: markerTarget ?? "",
    localChanges: diffData.scopeStatesByScope.uncommitted.localChanges,
    upstreamAheadBehind: diffData.upstreamAheadBehind,
    detectedConflict: diffData.gitConflict ?? null,
    detectedConflictedFiles: conflictedFiles,
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: gitRefresh.refresh,
    applyLocalChanges: reads.applyLocalChanges,
  });
  const fileModel = {
    ...workspaceFileModel({
      workingDirectory,
      resolvedTarget: markerTarget,
      branchReady,
      isFilesActive,
      selectedFile,
      onSelectFile,
    }),
    branchKey,
  };
  const diffsContent = (
    <WorkspaceSessionGitTools
      key={JSON.stringify([repoPath, workingDirectory])}
      commentOwner={commentOwner}
      actions={actions}
      diffData={diffData}
      contextMode={contextMode}
      repositoryBranchControl={repositoryBranchControl}
      branchReady={branchReady}
      resolvedTarget={markerTarget}
      control={control}
      unavailableReason={unavailableReason}
      workingDirectory={workingDirectory}
      manualRefresh={gitRefresh.manual}
      onSelectFile={onSelectFile}
    />
  );
  const filesContent = <TaskExecutionFileExplorerPanel model={fileModel} />;
  return { diffsContent, filesContent, refresh: isVisible ? gitRefresh.refreshTools : null };
}

/**
 * Connects the session panel to its refresh coordinator. A Refresh, its pending state, and its
 * failure belong to the session, directory, target choice, and checkout.
 */
function useWorkspaceGitRefresh({
  sessionKey,
  repoPath,
  workingDirectory,
  savedTarget,
  branchKey,
  visible,
  ready,
  prepare,
  readBranch,
  comparison,
  reads,
}: {
  sessionKey: string;
  repoPath: string;
  workingDirectory: string | null;
  savedTarget: GitTargetBranch | null;
  branchKey: string;
  visible: boolean;
  ready: boolean;
  prepare: (() => Promise<void>) | null;
  readBranch: () => Promise<string>;
  comparison: GitRefreshComparison | null;
  reads: GitPanelReads;
}) {
  const queryClient = useQueryClient();
  const scopeKey = JSON.stringify([sessionKey, repoPath, workingDirectory, savedTarget ?? null]);
  const withFiles = useMemo(
    () =>
      withFileQueries(
        queryClient,
        workingDirectory ? [workingDirectory] : [],
        JSON.stringify([scopeKey, branchKey]),
      ),
    [branchKey, queryClient, scopeKey, workingDirectory],
  );
  const shown = visible && workingDirectory !== null;
  const gitRefresh = useGitRefresh({
    view: {
      scopeKey,
      branchKey,
      visible: shown,
      ready,
      prepare,
      steps: {
        readBranch,
        comparison,
        readLocal: reads.readLocal,
        readComparison: reads.readComparison,
        readInBackground: reads.readInBackground,
        markStale: reads.markStale,
      },
      withFiles,
    },
    refreshOnFocus: shown,
  });
  const { refresh } = gitRefresh;
  const refreshTools = useCallback(() => refresh("soft"), [refresh]);
  return { ...gitRefresh, refreshTools };
}

function workspaceFileModel({
  workingDirectory,
  resolvedTarget,
  branchReady,
  isFilesActive,
  selectedFile,
  onSelectFile,
}: {
  workingDirectory: string | null;
  resolvedTarget: string | null;
  branchReady: boolean;
  isFilesActive: boolean;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
}): TaskExecutionFileExplorerPanelModel {
  let unavailableReason: string | null = null;
  if (!workingDirectory) {
    unavailableReason = missingWorkingDirectoryReason;
  } else if (!branchReady) {
    unavailableReason = "Checking branch...";
  }
  return {
    rootPath: workingDirectory,
    targetBranch: resolvedTarget,
    unavailableReason,
    isActive: isFilesActive && branchReady,
    selectedFile,
    onSelectFile,
  };
}

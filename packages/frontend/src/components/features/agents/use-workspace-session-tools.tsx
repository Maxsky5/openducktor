import type { GitTargetBranch, WorkspaceSessionRefInput } from "@openducktor/contracts";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { ResolveGitConflict } from "@openducktor/frontend-core/git/conflicts/conflict-assistance";
import { collectUnmergedFilePaths } from "@openducktor/frontend-core/git/model/unmerged-file-paths";
import {
  useWorkspaceSessionGitPanel,
  type WorkspaceSessionGitSource,
} from "@openducktor/frontend-core/git/workspace-session/use-workspace-session-git-panel";
import { useSessionComparisonControl } from "@/features/agent-studio-git/use-session-comparison-control";
import { windowReturnVisibility } from "@/lib/window-return-visibility";
import { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import type {
  TaskExecutionFileExplorerPanelModel,
  TaskExecutionSelectedFile,
} from "./task-execution-file-explorer-model";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";
import { WorkspaceSessionGitTools } from "./workspace-session-git-tools";

const missingWorkingDirectoryReason = "The selected working directory is unavailable.";

type WorkspaceSessionToolsProps = {
  isVisible: boolean;
  onResolveGitConflict?: ResolveGitConflict;
  conflictAssistanceBlockedReason?: string | null;
  conflictAssistanceIsStarting?: boolean;
  repoPath: string;
  workspaceSession: WorkspaceSessionRefInput;
  contextMode: "repository" | "worktree";
  /** The session directory, branch, and target from `useWorkspaceSessionGit`. */
  git: WorkspaceSessionGitSource;
  applyTarget: (target: GitTargetBranch) => Promise<void>;
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
  workspaceSession,
  contextMode,
  git,
  applyTarget,
  isFilesActive,
  selectedFile,
  onSelectFile,
  repositoryBranchControl,
}: WorkspaceSessionToolsProps) {
  const { workspaceId, sessionId } = workspaceSession;
  const { workingDirectory, target } = git;
  const { branchKey, branchReady } = git.branch;
  const {
    sessionKey,
    commentOwner,
    comparison,
    readsRepoPath,
    diffData,
    unavailableReason,
    resolvedTarget: markerTarget,
    applyLocalChanges,
    refresh,
    manualRefresh,
    refreshTools,
  } = useWorkspaceSessionGitPanel({
    isVisible,
    repoPath,
    workspaceId,
    sessionId,
    git,
    visibility: windowReturnVisibility,
  });
  const control = useSessionComparisonControl({
    repoPath,
    target,
    editable: isVisible,
    allowUpstream: contextMode === "repository",
    applyTarget,
    helpText: "This choice applies only to this chat. The chat saves it.",
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
    refreshDiffData: refresh,
    applyLocalChanges,
  });
  const fileModel = {
    ...workspaceFileModel({
      workingDirectory,
      workspaceSession,
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
      manualRefresh={manualRefresh}
      onSelectFile={onSelectFile}
    />
  );
  const filesContent = <TaskExecutionFileExplorerPanel model={fileModel} />;
  return { diffsContent, filesContent, refresh: isVisible ? refreshTools : null };
}

function workspaceFileModel({
  workingDirectory,
  workspaceSession,
  resolvedTarget,
  branchReady,
  isFilesActive,
  selectedFile,
  onSelectFile,
}: {
  workingDirectory: string | null;
  workspaceSession: WorkspaceSessionRefInput;
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
    workspaceSession,
    targetBranch: resolvedTarget,
    unavailableReason,
    isActive: isFilesActive && branchReady,
    selectedFile,
    onSelectFile,
  };
}

import { useMemo } from "react";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import type { GitPanelReads } from "@openducktor/frontend-core/git/reads/use-git-panel-reads";
import type {
  GitRefresh,
  ManualRefresh,
} from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import type { TaskGitContextMode } from "@openducktor/frontend-core/git/task/task-worktree-paths";
import { useTaskGitPanel } from "@openducktor/frontend-core/git/task/use-task-git-panel";
import type { TaskWorktreeState } from "@openducktor/frontend-core/git/task/use-task-worktree";
import type { useSessionComparison } from "@openducktor/frontend-core/git/use-session-comparison";
import type { resolveTaskTargetBranchState } from "@openducktor/frontend-core/lib/target-branch";
import { windowReturnVisibility } from "@/lib/window-return-visibility";
import {
  type BuildToolsOpenInTarget,
  resolveBuildToolsOpenInTarget,
  resolveBuildToolsSelectedTaskId,
  resolveDirectBuildWorktreePath,
} from "./build-tools-paths";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "@/pages/agents/right-panel/agents-page-git-panel";
import type { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type { useWorkspaceState } from "@/state/app-state-provider";
import {
  type BuildToolsSelectedView,
  useAgentStudioBuildToolsBootstrap,
} from "./use-agent-studio-build-tools-bootstrap";

type UseAgentStudioBuildToolsWorktreeSnapshotArgs = {
  workspaceRepoPath: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  selectedView: BuildToolsSelectedView;
  isGitTabActive: boolean;
  isRightPanelOpen: boolean;
  repoSettings: ReturnType<typeof useAgentStudioRepoSettings>["repoSettings"];
  repoSettingsError: ReturnType<typeof useAgentStudioRepoSettings>["repoSettingsError"];
  loadRepoSettings: ReturnType<typeof useAgentStudioRepoSettings>["loadRepoSettings"];
};

export type AgentStudioBuildToolsWorktreeSnapshot = {
  isEnabled: boolean;
  context: {
    repoPath: string | null;
    taskId: string | null;
    selectedTaskId: string | null;
    viewRole: BuildToolsSelectedView["role"];
    sessionWorkingDirectory: string | null;
    hasSelectedTask: boolean;
  };
  gitPanelContextMode: TaskGitContextMode;
  targetBranchState: ReturnType<typeof resolveTaskTargetBranchState>;
  resolvedGitPanelBranch: string | null;
  repositoryBranchIdentityKey: string | null;
  worktree: TaskWorktreeState;
  diffData: DiffDataState;
  comparison?: ReturnType<typeof useSessionComparison>;
  openInTarget: BuildToolsOpenInTarget;
  /** Refreshes the shown Git context. A caller can add its own file reads. */
  refreshWorktree: GitRefresh;
  /** Shows the local changes that a Git change returned. */
  applyLocalChanges: GitPanelReads["applyLocalChanges"];
  /** The manual Refresh of the shown context. */
  manualRefresh: ManualRefresh;
};

export function useAgentStudioBuildToolsWorktreeSnapshot({
  workspaceRepoPath,
  activeBranch,
  selectedView,
  isGitTabActive,
  isRightPanelOpen,
  repoSettings,
  repoSettingsError,
  loadRepoSettings,
}: UseAgentStudioBuildToolsWorktreeSnapshotArgs): AgentStudioBuildToolsWorktreeSnapshot {
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    workspaceRepoPath,
    selectedView,
    isGitTabActive,
  });
  const {
    sessionWorktreePath,
    gitPanelContextMode,
    repositoryBranchIdentityKey,
    selectedTaskId,
    hasSelectedTask,
    isEnabled,
    repoPath,
    taskId,
    taskWorktreeVersion,
  } = taskGitContext(workspaceRepoPath, activeBranch, selectedView, buildToolsBootstrap);
  const panel = useTaskGitPanel({
    repoPath,
    taskId,
    contextMode: gitPanelContextMode,
    sessionWorktreePath,
    viewKey: JSON.stringify([repoPath, taskId, selectedView.selectedSession.identity]),
    repositoryBranchKey: repositoryBranchIdentityKey,
    savedTarget: selectedView.selectedTask?.targetBranch,
    savedTargetError: selectedView.selectedTask?.targetBranchError ?? null,
    taskWorktreeVersion,
    repoSettings,
    repoSettingsError,
    loadRepoSettings,
    isEnabled,
    resolveWorktree: isRightPanelOpen,
    hasSelectedTask,
    refreshOnFocus: buildToolsBootstrap.shouldEnableScheduledRefresh && isEnabled,
    visibility: windowReturnVisibility,
  });
  const { worktree, diffData, currentBranch, queriedWorktreePath } = panel;
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: currentBranch ?? activeBranch,
    diffBranch: diffData.branch,
  });
  const openInTarget = useMemo(
    () =>
      resolveBuildToolsOpenInTarget({
        contextMode: gitPanelContextMode,
        repoPath: workspaceRepoPath,
        worktreePath: diffData.worktreePath,
        queriedWorktreePath,
        sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
        isWorktreeResolving: worktree.isResolving,
      }),
    [
      buildToolsBootstrap.sessionWorkingDirectory,
      diffData.worktreePath,
      gitPanelContextMode,
      worktree.isResolving,
      queriedWorktreePath,
      workspaceRepoPath,
    ],
  );

  return useMemo(
    () => ({
      isEnabled,
      context: {
        repoPath,
        taskId,
        selectedTaskId,
        viewRole: selectedView.role,
        sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
        hasSelectedTask,
      },
      gitPanelContextMode,
      targetBranchState: panel.targetBranchState,
      resolvedGitPanelBranch,
      repositoryBranchIdentityKey,
      worktree,
      diffData,
      comparison: panel.comparison,
      openInTarget,
      refreshWorktree: panel.refresh,
      applyLocalChanges: panel.applyLocalChanges,
      manualRefresh: panel.manualRefresh,
    }),
    [
      panel.applyLocalChanges,
      panel.comparison,
      panel.manualRefresh,
      panel.refresh,
      panel.targetBranchState,
      buildToolsBootstrap.sessionWorkingDirectory,
      diffData,
      gitPanelContextMode,
      hasSelectedTask,
      isEnabled,
      openInTarget,
      repoPath,
      resolvedGitPanelBranch,
      repositoryBranchIdentityKey,
      selectedTaskId,
      selectedView.role,
      taskId,
      worktree,
    ],
  );
}

function taskGitContext(
  workspaceRepoPath: string | null,
  activeBranch: UseAgentStudioBuildToolsWorktreeSnapshotArgs["activeBranch"],
  selectedView: BuildToolsSelectedView,
  buildToolsBootstrap: ReturnType<typeof useAgentStudioBuildToolsBootstrap>,
) {
  const sessionWorktreePath = resolveDirectBuildWorktreePath({
    repoPath: workspaceRepoPath,
    sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
  });
  const usesTaskWorktree =
    selectedView.role === "build" || selectedView.role === "qa" || sessionWorktreePath != null;
  const gitPanelContextMode: TaskGitContextMode = usesTaskWorktree ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const selectedTaskId = resolveBuildToolsSelectedTaskId({
    viewTaskId: selectedView.taskId,
    viewSelectedTaskId: selectedView.selectedTask?.id ?? null,
  });
  const hasSelectedTask = selectedTaskId != null;
  const isEnabled = buildToolsBootstrap.isEnabled && hasSelectedTask;
  const hasGitContext = buildToolsBootstrap.repoPath != null && hasSelectedTask;
  const repoPath = hasGitContext ? buildToolsBootstrap.repoPath : null;
  const taskId = hasGitContext ? selectedTaskId : null;
  const taskWorktreeVersion = selectedView.selectedTask?.updatedAt ?? null;
  return {
    sessionWorktreePath,
    gitPanelContextMode,
    repositoryBranchIdentityKey,
    selectedTaskId,
    hasSelectedTask,
    isEnabled,
    repoPath,
    taskId,
    taskWorktreeVersion,
  };
}

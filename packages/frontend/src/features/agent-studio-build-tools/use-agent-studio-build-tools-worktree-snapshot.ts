import type { DevServerOwner } from "@openducktor/contracts";
import { useMemo } from "react";
import { hostClient } from "@/lib/host-client";
import { resolveTaskTargetBranchState, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "@/pages/agents/right-panel/agents-page-git-panel";
import type { useAgentStudioDevServerPanel } from "@/features/dev-servers/use-agent-studio-dev-server-panel";
import type { useAgentStudioOrchestrationController } from "@/pages/agents/use-agent-studio-orchestration-controller";
import type { useWorkspaceState } from "@/state/app-state-provider";
import type { TaskWorktreeQueryHost } from "@/state/queries/build-runtime";
import type {
  DiffDataState,
  GitDiffRefresh,
  UseAgentStudioDiffDataInput,
} from "../agent-studio-git/contracts";
import { useAgentStudioDiffData } from "../agent-studio-git/use-agent-studio-diff-data";
import {
  type AgentStudioGitPanelContextMode,
  type BuildToolsOpenInTarget,
  resolveBuildToolsOpenInTarget,
  resolveBuildToolsSelectedTaskId,
  resolveDirectBuildWorktreePath,
} from "./agent-studio-build-tools-worktree-snapshot";
import {
  type BuildToolsWorktreeSnapshotState,
  useBuildToolsWorktree,
} from "./use-build-tools-worktree";
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
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
};

type AgentStudioBuildToolsWorktreeSnapshotDependencies = {
  taskWorktreeHost: TaskWorktreeQueryHost;
  useDiffData: typeof useAgentStudioDiffData;
};

type AgentStudioDevServerTarget = Parameters<typeof useAgentStudioDevServerPanel>[0];

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
  gitPanelContextMode: AgentStudioGitPanelContextMode;
  targetBranchState: ReturnType<typeof resolveTaskTargetBranchState>;
  resolvedGitPanelBranch: string | null;
  worktree: BuildToolsWorktreeSnapshotState;
  diffData: DiffDataState;
  /** The right panel reads the dev server for this target. */
  devServerTarget: AgentStudioDevServerTarget;
  openInTarget: BuildToolsOpenInTarget;
  refreshWorktree: GitDiffRefresh;
};

const DEFAULT_SNAPSHOT_DEPENDENCIES: AgentStudioBuildToolsWorktreeSnapshotDependencies = {
  taskWorktreeHost: hostClient,
  useDiffData: useAgentStudioDiffData,
};

function useAgentStudioBuildToolsWorktreeSnapshotWithDependencies(
  {
    workspaceRepoPath,
    activeBranch,
    selectedView,
    isGitTabActive,
    isRightPanelOpen,
    repoSettings,
  }: UseAgentStudioBuildToolsWorktreeSnapshotArgs,
  dependencies: AgentStudioBuildToolsWorktreeSnapshotDependencies,
): AgentStudioBuildToolsWorktreeSnapshot {
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    workspaceRepoPath,
    selectedView,
    isGitTabActive,
    isRightPanelOpen,
  });
  const sessionWorktreePath = resolveDirectBuildWorktreePath({
    repoPath: workspaceRepoPath,
    sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
  });
  const usesTaskWorktree =
    selectedView.role === "build" || selectedView.role === "qa" || sessionWorktreePath != null;
  const gitPanelContextMode: AgentStudioGitPanelContextMode = usesTaskWorktree
    ? "worktree"
    : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const selectedTaskId = resolveBuildToolsSelectedTaskId({
    viewTaskId: selectedView.taskId,
    viewSelectedTaskId: selectedView.selectedTask?.id ?? null,
  });
  const hasSelectedTask = selectedTaskId != null;
  const taskTargetBranchState = useMemo(
    () =>
      resolveTaskTargetBranchState({
        taskTargetBranch: selectedView.selectedTask?.targetBranch,
        taskTargetBranchError: selectedView.selectedTask?.targetBranchError ?? null,
        defaultTargetBranch: repoSettings?.defaultTargetBranch,
      }),
    [
      repoSettings?.defaultTargetBranch,
      selectedView.selectedTask?.targetBranch,
      selectedView.selectedTask?.targetBranchError,
    ],
  );
  const worktreeDiffPreconditionError =
    gitPanelContextMode === "worktree" ? taskTargetBranchState.validationError : null;
  const diffComparisonTarget = useMemo(
    () =>
      gitPanelContextMode === "repository"
        ? { branch: UPSTREAM_TARGET_BRANCH }
        : taskTargetBranchState.effectiveTargetBranch,
    [gitPanelContextMode, taskTargetBranchState.effectiveTargetBranch],
  );
  const isEnabled = buildToolsBootstrap.isEnabled && hasSelectedTask;
  const hasGitContext = buildToolsBootstrap.repoPath != null && hasSelectedTask;
  const repoPath = hasGitContext ? buildToolsBootstrap.repoPath : null;
  const taskId = hasGitContext ? selectedTaskId : null;
  const taskWorktreeVersion = selectedView.selectedTask?.updatedAt ?? null;
  const devServerTarget = useMemo(
    () =>
      buildDevServerTarget(
        buildToolsBootstrap.isDevServerEnabled,
        buildToolsBootstrap.repoPath,
        hasSelectedTask,
        selectedView.selectedTask?.id ?? null,
      ),
    [
      buildToolsBootstrap.isDevServerEnabled,
      buildToolsBootstrap.repoPath,
      hasSelectedTask,
      selectedView.selectedTask?.id,
    ],
  );
  const { worktree, queriedPath, diffResolutionTaskId } = useBuildToolsWorktree({
    host: dependencies.taskWorktreeHost,
    repoPath,
    taskId,
    contextMode: gitPanelContextMode,
    sessionWorktreePath,
    isEnabled,
    isRightPanelOpen,
    hasSelectedTask,
    taskWorktreeVersion,
  });

  const diffDataInput: UseAgentStudioDiffDataInput = {
    repoPath,
    worktreePath: worktree.path,
    worktreeResolutionTaskId: diffResolutionTaskId,
    shouldBlockDiffLoading: worktree.shouldBlockDiffLoading,
    isWorktreeResolutionResolving: worktree.isResolving,
    worktreeResolutionError: worktree.error,
    retryWorktreeResolution: worktree.retry,
    defaultTargetBranch: diffComparisonTarget,
    branchIdentityKey: repositoryBranchIdentityKey,
    enableScheduledRefresh: buildToolsBootstrap.shouldEnableScheduledRefresh && isEnabled,
  };
  if (worktreeDiffPreconditionError) {
    diffDataInput.preconditionError = worktreeDiffPreconditionError;
  }
  const diffData = dependencies.useDiffData(diffDataInput);
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
    diffBranch: diffData.branch,
  });
  const openInTarget = useMemo(
    () =>
      resolveBuildToolsOpenInTarget({
        contextMode: gitPanelContextMode,
        repoPath: workspaceRepoPath,
        worktreePath: diffData.worktreePath,
        queriedWorktreePath: queriedPath,
        sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
        isWorktreeResolving: worktree.isResolving,
      }),
    [
      buildToolsBootstrap.sessionWorkingDirectory,
      diffData.worktreePath,
      gitPanelContextMode,
      worktree.isResolving,
      queriedPath,
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
      targetBranchState: taskTargetBranchState,
      resolvedGitPanelBranch,
      worktree,
      diffData,
      devServerTarget,
      openInTarget,
      refreshWorktree: diffData.refresh,
    }),
    [
      buildToolsBootstrap.sessionWorkingDirectory,
      devServerTarget,
      diffData,
      gitPanelContextMode,
      hasSelectedTask,
      isEnabled,
      openInTarget,
      repoPath,
      resolvedGitPanelBranch,
      selectedTaskId,
      selectedView.role,
      taskTargetBranchState,
      taskId,
      worktree,
    ],
  );
}

export function useAgentStudioBuildToolsWorktreeSnapshot(
  args: UseAgentStudioBuildToolsWorktreeSnapshotArgs,
): AgentStudioBuildToolsWorktreeSnapshot {
  return useAgentStudioBuildToolsWorktreeSnapshotWithDependencies(
    args,
    DEFAULT_SNAPSHOT_DEPENDENCIES,
  );
}

function buildDevServerTarget(
  enabled: boolean,
  repoPath: string | null,
  hasSelectedTask: boolean,
  taskId: string | null,
): AgentStudioDevServerTarget {
  const path = enabled ? repoPath : null;
  const owner: DevServerOwner | null =
    enabled && hasSelectedTask && taskId ? { kind: "task", taskId } : null;
  return { repoPath: path, owner, enabled: path !== null && owner !== null };
}

/** @internal Test-only dependency seam; production callers should use the default hook above. */
export const createAgentStudioBuildToolsWorktreeSnapshotHookForTest = (
  overrides: Partial<AgentStudioBuildToolsWorktreeSnapshotDependencies>,
) => {
  const dependencies = {
    ...DEFAULT_SNAPSHOT_DEPENDENCIES,
    ...overrides,
  };

  return (args: UseAgentStudioBuildToolsWorktreeSnapshotArgs) =>
    useAgentStudioBuildToolsWorktreeSnapshotWithDependencies(args, dependencies);
};

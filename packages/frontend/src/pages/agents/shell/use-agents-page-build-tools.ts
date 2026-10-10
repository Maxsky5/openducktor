import { useMemo } from "react";
import type { BuildToolsSelectedView } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import {
  type AgentStudioBuildToolsWorktreeSnapshot,
  useAgentStudioBuildToolsWorktreeSnapshot,
} from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import { collectUnmergedFilePaths } from "@/features/agent-studio-git";
import type { useWorkspaceState } from "@/state";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";
import { useAgentStudioGitActions } from "../use-agent-studio-git-actions";
import type { useAgentStudioRepoSettings } from "../use-agent-studio-repo-settings";

export type AgentsPageBuildTools = {
  buildToolsSnapshot: AgentStudioBuildToolsWorktreeSnapshot;
  gitActions: ReturnType<typeof useAgentStudioGitActions>;
};

/**
 * Owns the Build Tools state of the Task Workflows page: the worktree snapshot and the git actions.
 * The page shell calls it, so the chat header and the git panel read the same git conflict.
 */
export function useAgentsPageBuildTools({
  activeWorkspace,
  activeBranch,
  selectedView,
  isDiffsActive,
  isPanelOpen,
  repoSettings,
  repoSettingsError,
  loadRepoSettings,
  onResolveGitConflict,
}: {
  activeWorkspace: ActiveWorkspace | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  selectedView: BuildToolsSelectedView;
  /** True while the Diffs tab is selected in the shown right panel. */
  isDiffsActive: boolean;
  isPanelOpen: boolean;
  repoSettings: RepoSettingsInput | null;
  repoSettingsError: ReturnType<typeof useAgentStudioRepoSettings>["repoSettingsError"];
  loadRepoSettings: ReturnType<typeof useAgentStudioRepoSettings>["loadRepoSettings"];
  onResolveGitConflict: Parameters<typeof useAgentStudioGitActions>[0]["onResolveGitConflict"];
}): AgentsPageBuildTools {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const buildToolsSnapshot = useAgentStudioBuildToolsWorktreeSnapshot({
    workspaceRepoPath,
    activeBranch,
    selectedView,
    isGitTabActive: isDiffsActive,
    isRightPanelOpen: isPanelOpen,
    repoSettings,
    repoSettingsError,
    loadRepoSettings,
  });
  const { diffData, resolvedGitPanelBranch } = buildToolsSnapshot;

  const detectedConflictedFiles = useMemo(
    () => collectUnmergedFilePaths(diffData.fileStatuses),
    [diffData.fileStatuses],
  );
  const gitActionInput: Parameters<typeof useAgentStudioGitActions>[0] = {
    contextKey: buildToolsSnapshot.comparison?.contextKey,
    repoPath: workspaceRepoPath,
    workingDir: diffData.worktreePath,
    branch: resolvedGitPanelBranch,
    targetBranch: diffData.comparisonReference ?? "",
    resetTargetBranch: "HEAD",
    detectedConflict: diffData.gitConflict ?? null,
    hashVersion: diffData.hashVersion,
    statusHash: diffData.statusHash,
    diffHash: diffData.diffHash,
    upstreamAheadBehind: diffData.upstreamAheadBehind ?? null,
    detectedConflictedFiles,
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: buildToolsSnapshot.refreshWorktree,
    isDiffDataLoading: diffData.isLoading,
  };
  if (onResolveGitConflict) {
    gitActionInput.onResolveGitConflict = onResolveGitConflict;
  }
  const gitActions = useAgentStudioGitActions(gitActionInput);

  return useMemo(() => ({ buildToolsSnapshot, gitActions }), [buildToolsSnapshot, gitActions]);
}

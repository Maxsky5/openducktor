import { GitBranch } from "lucide-react";
import { memo, type ReactElement, type ReactNode, useMemo } from "react";
import { collectUnmergedFilePaths, type DiffDataState } from "@/features/agent-studio-git";
import { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
import { SharedToolsPanel, type SharedToolsPanelModel } from "./shared-tools-panel";
import type { WorkspaceToolsTabId } from "./workspace-session-tools-panel";

export function WorkspaceSessionGitTools({
  subjectKey,
  repoPath,
  diffData,
  contextMode,
  repositoryBranchControl,
  branchReady,
  resolvedTarget,
  unavailableReason,
  workingDirectory,
  isFetchingTarget,
  refresh,
  refreshDiffData,
  tools,
}: WorkspaceSessionGitToolsProps): ReactElement {
  const conflictedFiles = useMemo(
    () => collectUnmergedFilePaths(diffData.fileStatuses),
    [diffData.fileStatuses],
  );
  const actions = useAgentStudioGitActions({
    repoPath: workingDirectory ? repoPath : null,
    workingDir: workingDirectory,
    branch: diffData.branch,
    targetBranch: resolvedTarget ?? "",
    resetTargetBranch: resolvedTarget ?? "HEAD",
    hashVersion: diffData.hashVersion,
    statusHash: diffData.statusHash,
    diffHash: diffData.diffHash,
    upstreamAheadBehind: diffData.upstreamAheadBehind,
    detectedConflict: diffData.gitConflict ?? null,
    detectedConflictedFiles: conflictedFiles,
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData,
    isDiffDataLoading: diffData.isLoading,
  });
  const model: AgentStudioGitPanelModel = {
    ...diffData,
    ...actions,
    subjectKey,
    refresh,
    isLoading: diffData.isLoading || isFetchingTarget || !branchReady,
    contextMode,
    repositoryBranchControl,
    targetBranch: resolvedTarget ?? "",
    comparisonUnavailableReason: unavailableReason,
    diffScope: resolvedTarget ? diffData.diffScope : "uncommitted",
    commitsAheadBehind: resolvedTarget ? diffData.commitsAheadBehind : null,
    scopeStatesByScope: resolvedTarget
      ? diffData.scopeStatesByScope
      : {
          ...diffData.scopeStatesByScope,
          target: {
            ...diffData.scopeStatesByScope.target,
            fileDiffs: [],
            fileStatuses: [],
            commitsAheadBehind: null,
            error: null,
          },
        },
    rebaseOntoTarget: resolvedTarget ? actions.rebaseOntoTarget : undefined,
    askBuilderToResolveGitConflict: undefined,
    openInTargetPath: workingDirectory,
    openInDisabledReason: workingDirectory
      ? null
      : "The selected working directory is unavailable.",
  };
  return (
    <SharedToolsPanel
      model={{
        ...tools,
        tabs: [
          { id: "git", label: "Git", icon: GitBranch, content: <GitPanel {...model} /> },
          ...tools.tabs,
        ],
      }}
    />
  );
}

type WorkspaceSessionGitToolsProps = {
  subjectKey: string;
  tools: SharedToolsPanelModel<WorkspaceToolsTabId>;
  repoPath: string;
  diffData: DiffDataState;
  contextMode: "repository" | "worktree";
  repositoryBranchControl?: ReactNode;
  branchReady: boolean;
  resolvedTarget: string | null;
  unavailableReason: string | null;
  workingDirectory: string | null;
  isFetchingTarget: boolean;
  refresh: () => Promise<void>;
  refreshDiffData: () => Promise<void>;
};

// Keep dev-server updates from redrawing unchanged Git data.
const GitPanel = memo(function GitPanel(model: AgentStudioGitPanelModel): ReactElement {
  return <AgentStudioGitPanel model={model} />;
});

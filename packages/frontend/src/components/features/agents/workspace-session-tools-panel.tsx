import type { GitComparisonTarget, GitTargetBranch } from "@openducktor/contracts";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, GitBranch } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import { OpenInMenu } from "./agent-studio-git-panel/open-in-menu";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
import { SharedToolsPanel } from "./shared-tools-panel";
import { type DiffDataState, useAgentStudioDiffData } from "@/features/agent-studio-git";
import { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { filesystemQueryKeys, invalidateWorkspaceFileQueries } from "@/state/queries/filesystem";
import { gitComparisonTargetQueryOptions, gitQueryKeys } from "@/state/queries/git";

export type WorkspaceToolsTabId = "git" | "file_explorer";

const missingWorkingDirectoryReason = "The selected working directory is unavailable.";

function comparisonUnavailableReason(input: {
  targetError: string | null;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  data: GitComparisonTarget | undefined;
}): string | null {
  if (input.targetError) return input.targetError;
  if (input.isPending) return "Checking the comparison target…";
  if (input.isError) return errorMessage(input.error);
  return input.data?.kind === "unavailable" ? input.data.reason : null;
}

function workspaceGitModel(input: {
  diffData: DiffDataState;
  actions: ReturnType<typeof useAgentStudioGitActions>;
  contextMode: "repository" | "worktree";
  resolvedTarget: string | null;
  unavailableReason: string | null;
  workingDirectory: string | null;
  refresh: () => Promise<void>;
}): AgentStudioGitPanelModel {
  const {
    diffData,
    actions,
    contextMode,
    resolvedTarget,
    unavailableReason,
    workingDirectory,
    refresh,
  } = input;
  return {
    ...diffData,
    ...actions,
    refresh,
    contextMode,
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
    openInDisabledReason: workingDirectory ? null : missingWorkingDirectoryReason,
  };
}

function WorkspaceOpenInAction({
  contextMode,
  workingDirectory,
}: {
  contextMode: "repository" | "worktree";
  workingDirectory: string | null;
}) {
  return (
    <OpenInMenu
      contextMode={contextMode}
      targetPath={workingDirectory}
      targetLabel={contextMode === "repository" ? "repository root" : "workspace worktree"}
      disabledReason={workingDirectory ? null : missingWorkingDirectoryReason}
      onOpenInTool={
        workingDirectory
          ? (toolId) => hostClient.systemOpenDirectoryInTool(workingDirectory, toolId)
          : undefined
      }
    />
  );
}

async function refreshWorkspaceSessionData(input: {
  queryClient: QueryClient;
  diffData: ReturnType<typeof useAgentStudioDiffData>;
  refetchComparison: () => Promise<{
    isError: boolean;
    data: GitComparisonTarget | undefined;
  }>;
  resolvedTarget: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  workingDirectory: string | null;
}): Promise<void> {
  const {
    queryClient,
    diffData,
    refetchComparison,
    resolvedTarget,
    target,
    targetError,
    workingDirectory,
  } = input;
  if (workingDirectory && target && !targetError) {
    const checkedComparison = await refetchComparison();
    const checkedTarget =
      !checkedComparison.isError && checkedComparison.data?.kind === "available"
        ? checkedComparison.data.reference
        : null;
    if (checkedTarget !== resolvedTarget) {
      await queryClient.invalidateQueries({
        queryKey: filesystemQueryKeys.treeRoot(workingDirectory),
        refetchType: "none",
      });
      return;
    }
  }
  await Promise.all([
    resolvedTarget ? diffData.refreshAllScopes() : diffData.refresh("soft"),
    workingDirectory
      ? invalidateWorkspaceFileQueries(queryClient, workingDirectory)
      : Promise.resolve(),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.all,
      predicate: (query) => query.queryKey.includes(workingDirectory),
      refetchType: "none",
    }),
  ]);
}

function useWorkspaceSessionComparison(input: {
  repoPath: string;
  workingDirectory: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
}) {
  const { repoPath, workingDirectory, target, targetError } = input;
  const comparison = useQuery({
    ...gitComparisonTargetQueryOptions(
      repoPath,
      workingDirectory ?? "__missing_working_directory__",
      target ?? { branch: "HEAD" },
    ),
    enabled: workingDirectory !== null && target !== null && targetError === null,
  });
  const resolvedTarget =
    workingDirectory &&
    target &&
    !targetError &&
    !comparison.isError &&
    comparison.data?.kind === "available"
      ? comparison.data.reference
      : null;
  return {
    resolvedTarget,
    unavailableReason: comparisonUnavailableReason({
      targetError,
      isPending: comparison.isPending,
      isError: comparison.isError,
      error: comparison.error,
      data: comparison.data,
    }),
    refetchComparison: comparison.refetch,
  };
}

export function WorkspaceSessionToolsPanel({
  repoPath,
  workingDirectory,
  contextMode,
  target,
  targetError,
  activeTabId,
  onActiveTabChange,
  selectedFile,
  onSelectFile,
  onRefreshReady,
}: {
  repoPath: string;
  workingDirectory: string | null;
  contextMode: "repository" | "worktree";
  target: GitTargetBranch | null;
  targetError: string | null;
  activeTabId: WorkspaceToolsTabId;
  onActiveTabChange: (tab: WorkspaceToolsTabId) => void;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
  onRefreshReady: (refresh: (() => Promise<void>) | null) => void;
}) {
  const queryClient = useQueryClient();
  const { resolvedTarget, unavailableReason, refetchComparison } = useWorkspaceSessionComparison({
    repoPath,
    workingDirectory,
    target,
    targetError,
  });
  const readTarget = resolvedTarget ?? "HEAD";
  const diffData = useAgentStudioDiffData({
    repoPath: workingDirectory ? repoPath : null,
    worktreePath: workingDirectory,
    worktreeResolutionTaskId: null,
    shouldBlockDiffLoading: workingDirectory === null,
    isWorktreeResolutionResolving: false,
    worktreeResolutionError: null,
    retryWorktreeResolution: () => undefined,
    defaultTargetBranch: { branch: readTarget },
    branchIdentityKey: workingDirectory,
    enableScheduledRefresh: false,
  });
  const refresh = useCallback(
    () =>
      refreshWorkspaceSessionData({
        queryClient,
        diffData,
        refetchComparison,
        resolvedTarget,
        target,
        targetError,
        workingDirectory,
      }),
    [
      diffData,
      queryClient,
      refetchComparison,
      resolvedTarget,
      target,
      targetError,
      workingDirectory,
    ],
  );
  useEffect(() => {
    onRefreshReady(refresh);
    return () => onRefreshReady(null);
  }, [onRefreshReady, refresh]);
  const conflictedFiles = useMemo(
    () =>
      diffData.fileStatuses
        .filter((status) => status.status === "unmerged")
        .map((status) => status.path),
    [diffData.fileStatuses],
  );
  const actions = useAgentStudioGitActions({
    repoPath: workingDirectory ? repoPath : null,
    workingDir: workingDirectory,
    branch: diffData.branch,
    targetBranch: resolvedTarget ?? "",
    resetTargetBranch: readTarget,
    hashVersion: diffData.hashVersion,
    statusHash: diffData.statusHash,
    diffHash: diffData.diffHash,
    upstreamAheadBehind: diffData.upstreamAheadBehind,
    detectedConflict: diffData.gitConflict ?? null,
    detectedConflictedFiles: conflictedFiles,
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: refresh,
    isDiffDataLoading: diffData.isLoading,
  });
  const gitModel = workspaceGitModel({
    diffData,
    actions,
    contextMode,
    resolvedTarget,
    unavailableReason,
    workingDirectory,
    refresh,
  });
  const fileModel = {
    rootPath: workingDirectory,
    targetBranch: resolvedTarget,
    unavailableReason: workingDirectory ? null : missingWorkingDirectoryReason,
    isActive: activeTabId === "file_explorer",
    selectedFile,
    onSelectFile,
  };
  return (
    <SharedToolsPanel
      model={{
        tabs: [
          {
            id: "git",
            label: "Git",
            icon: GitBranch,
            content: <AgentStudioGitPanel model={gitModel} />,
          },
          {
            id: "file_explorer",
            label: "File explorer",
            icon: FolderTree,
            content: <TaskExecutionFileExplorerPanel model={fileModel} />,
          },
        ],
        activeTabId,
        onActiveTabChange,
        tabListLabel: "Workspace session tools",
        testIdPrefix: "workspace-session-tools",
        headerActions: (
          <WorkspaceOpenInAction contextMode={contextMode} workingDirectory={workingDirectory} />
        ),
      }}
    />
  );
}

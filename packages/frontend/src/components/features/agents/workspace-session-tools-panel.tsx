import type { GitComparisonTarget, GitTargetBranch } from "@openducktor/contracts";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, GitBranch } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { canonicalTargetBranch } from "@/lib/target-branch";
import { filesystemQueryKeys, invalidateWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  gitComparisonTargetQueryOptions,
  invalidateGitWorkingDirectoryQueries,
} from "@/state/queries/git";

export type WorkspaceToolsTabId = "git" | "file_explorer";
type WorkspaceRefreshMode = "hard" | "soft" | "scheduled";

const missingWorkingDirectoryReason = "The selected working directory is unavailable.";

export function WorkspaceSessionToolsPanel({
  repoPath,
  workingDirectory,
  contextMode,
  branchKey,
  branchReady,
  target,
  targetError,
  retryTarget,
  activeTabId,
  onActiveTabChange,
  selectedFile,
  onSelectFile,
  onRefreshReady,
}: {
  repoPath: string;
  workingDirectory: string | null;
  contextMode: "repository" | "worktree";
  branchKey: string;
  branchReady: boolean;
  target: GitTargetBranch | null;
  targetError: string | null;
  retryTarget: () => Promise<void>;
  activeTabId: WorkspaceToolsTabId;
  onActiveTabChange: (tab: WorkspaceToolsTabId) => void;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
  onRefreshReady: (refresh: ((scope: "git" | "all") => Promise<void>) | null) => void;
}) {
  const queryClient = useQueryClient();
  const [isFetchingTarget, setIsFetchingTarget] = useState(false);
  const [retryRun, setRetryRun] = useState(0);
  const handledRetry = useRef(0);
  const { resolvedTarget, unavailableReason, isReady, refetchComparison } =
    useWorkspaceSessionComparison({
      repoPath,
      workingDirectory,
      target,
      targetError,
      branchKey,
      branchReady,
    });
  const readTarget = resolvedTarget ?? "HEAD";
  const diffData = useAgentStudioDiffData({
    repoPath: workingDirectory ? repoPath : null,
    worktreePath: workingDirectory,
    worktreeResolutionTaskId: null,
    shouldBlockDiffLoading: workingDirectory === null || !isReady,
    isWorktreeResolutionResolving: false,
    worktreeResolutionError: null,
    retryWorktreeResolution: () => undefined,
    defaultTargetBranch: { branch: readTarget },
    branchIdentityKey: `${workingDirectory ?? ""}:${branchKey}`,
    enableScheduledRefresh: false,
  });
  const refresh = useCallback(
    async (mode: WorkspaceRefreshMode = "hard", includeFiles = true) => {
      if (!branchReady) return;
      const fetchTarget =
        mode === "hard" &&
        !!workingDirectory &&
        (targetError !== null || (!resolvedTarget && !!target));
      if (fetchTarget) setIsFetchingTarget(true);
      try {
        if (mode === "hard" && targetError) {
          await retryTarget();
          setRetryRun((run) => run + 1);
          return;
        }
        await refreshWorkspaceSessionData({
          queryClient,
          diffData,
          refetchComparison,
          resolvedTarget,
          target,
          targetError,
          workingDirectory,
          repoPath,
          mode,
          includeFiles,
        });
      } catch (error) {
        toast.error("Could not refresh Git changes", { description: errorMessage(error) });
      } finally {
        setIsFetchingTarget(false);
      }
    },
    [
      branchReady,
      diffData,
      queryClient,
      refetchComparison,
      resolvedTarget,
      target,
      targetError,
      retryTarget,
      workingDirectory,
      repoPath,
    ],
  );
  useEffect(() => {
    if (retryRun === handledRetry.current || targetError) return;
    // Use the target from the render after the settings read succeeds.
    handledRetry.current = retryRun;
    void refresh("hard");
  }, [refresh, retryRun, targetError]);
  useEffect(() => {
    onRefreshReady((scope) => refresh("soft", scope === "all"));
    return () => onRefreshReady(null);
  }, [onRefreshReady, refresh]);
  const refreshWhenVisible = useEffectEvent(() => {
    if (document.visibilityState === "visible") void refresh("scheduled");
  });
  useEffect(() => {
    if (!workingDirectory) return;
    globalThis.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      globalThis.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [workingDirectory]);
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
    refreshDiffData: () => refresh("soft"),
    isDiffDataLoading: diffData.isLoading,
  });
  const gitModel = workspaceGitModel({
    diffData,
    actions,
    contextMode,
    branchReady,
    resolvedTarget,
    unavailableReason,
    workingDirectory,
    isFetchingTarget,
    refresh: () => refresh("hard"),
  });
  const fileModel = {
    rootPath: workingDirectory,
    targetBranch: resolvedTarget,
    unavailableReason: !workingDirectory
      ? missingWorkingDirectoryReason
      : !isReady
        ? branchReady
          ? "Checking comparison target..."
          : "Checking branch..."
        : null,
    isActive: activeTabId === "file_explorer" && isReady,
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
  branchReady: boolean;
  resolvedTarget: string | null;
  unavailableReason: string | null;
  workingDirectory: string | null;
  isFetchingTarget: boolean;
  refresh: () => Promise<void>;
}): AgentStudioGitPanelModel {
  const {
    diffData,
    actions,
    contextMode,
    branchReady,
    resolvedTarget,
    unavailableReason,
    workingDirectory,
    isFetchingTarget,
    refresh,
  } = input;
  return {
    ...diffData,
    ...actions,
    refresh,
    isLoading: diffData.isLoading || isFetchingTarget || !branchReady,
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
  repoPath: string;
  mode: WorkspaceRefreshMode;
  includeFiles: boolean;
}): Promise<void> {
  const {
    queryClient,
    diffData,
    refetchComparison,
    resolvedTarget,
    target,
    targetError,
    workingDirectory,
    repoPath,
    mode,
    includeFiles,
  } = input;
  if (workingDirectory && target && !targetError) {
    if (mode === "hard" && !resolvedTarget) {
      try {
        await hostClient.gitFetchRemote(repoPath, canonicalTargetBranch(target), workingDirectory);
      } catch (error) {
        toast.error("Could not refresh Git changes", { description: errorMessage(error) });
      }
    }
    const checkedComparison = await refetchComparison();
    const checkedTarget =
      !checkedComparison.isError && checkedComparison.data?.kind === "available"
        ? checkedComparison.data.reference
        : null;
    if (checkedTarget !== resolvedTarget) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: filesystemQueryKeys.treeRoot(workingDirectory),
          refetchType: "none",
        }),
        includeFiles
          ? queryClient.invalidateQueries({
              queryKey: filesystemQueryKeys.textFileRoot(workingDirectory),
            })
          : Promise.resolve(),
        invalidateGitWorkingDirectoryQueries(queryClient, repoPath, workingDirectory),
      ]);
      return;
    }
  }
  const refreshGit = async () => {
    if (!resolvedTarget) {
      await diffData.refresh("soft");
      return;
    }
    if (mode === "hard") {
      await diffData.refresh("hard");
      await diffData.refreshInactiveScope();
      return;
    }
    if (mode === "scheduled") {
      await diffData.refresh("scheduled");
      return;
    }
    await diffData.refreshAllScopes();
  };
  await Promise.all([
    refreshGit(),
    includeFiles && workingDirectory
      ? invalidateWorkspaceFileQueries(queryClient, workingDirectory)
      : Promise.resolve(),
    includeFiles && workingDirectory
      ? invalidateGitWorkingDirectoryQueries(queryClient, repoPath, workingDirectory)
      : Promise.resolve(),
  ]);
}

function useWorkspaceSessionComparison(input: {
  repoPath: string;
  workingDirectory: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  branchKey: string;
  branchReady: boolean;
}) {
  const { repoPath, workingDirectory, target, targetError, branchKey, branchReady } = input;
  const comparison = useQuery({
    ...gitComparisonTargetQueryOptions(
      repoPath,
      workingDirectory ?? "__missing_working_directory__",
      target ?? { branch: "HEAD" },
      branchKey,
    ),
    enabled: branchReady && workingDirectory !== null && target !== null && targetError === null,
  });
  const resolvedTarget =
    branchReady &&
    workingDirectory &&
    target &&
    !targetError &&
    !comparison.isError &&
    comparison.data?.kind === "available"
      ? comparison.data.reference
      : null;
  return {
    resolvedTarget,
    isReady:
      branchReady && (targetError !== null || comparison.isError || comparison.data !== undefined),
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

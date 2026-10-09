import type { ResolveGitConflict } from "@/features/git-conflict-resolution/conflict-assistance";
import type { DevServerOwner, GitComparisonTarget, GitTargetBranch } from "@openducktor/contracts";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { collectUnmergedFilePaths, useAgentStudioDiffData } from "@/features/agent-studio-git";
import { errorMessage } from "@/lib/errors";
import { gitRefreshPriority } from "@/lib/git-refresh-priority";
import { hostClient } from "@/lib/host-client";
import { canonicalTargetBranch } from "@/lib/target-branch";
import { filesystemQueryKeys, refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  gitComparisonTargetQueryOptions,
  invalidateGitWorkingDirectoryQueries,
} from "@/state/queries/git";
import type {
  TaskExecutionFileExplorerPanelModel,
  TaskExecutionSelectedFile,
} from "./task-execution-file-explorer-model";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";
import { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { WorkspaceSessionGitTools } from "./workspace-session-git-tools";
import { useGitCommentDraftValidation } from "./agent-studio-git-panel/use-git-comment-draft-validation";

export type WorkspaceToolsTabId = "git" | "file_explorer";
type WorkspaceRefreshMode = "hard" | "soft" | "scheduled";

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
  branchReady: boolean;
  target: GitTargetBranch | null;
  targetError: string | null;
  retryTarget: () => Promise<void>;
  readBranch: () => Promise<string>;
  activeTabId: WorkspaceToolsTabId;
  onActiveTabChange: (tab: WorkspaceToolsTabId) => void;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
  /** Replaces the read-only repository branch label for a repository-root session. */
  repositoryBranchControl?: ReactNode;
};

type WorkspaceToolsView = {
  isVisible: boolean;
  directoryKey: string;
  branchKey: string;
  refresh: WorkspaceRefresh["refresh"];
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
  branchReady,
  target,
  targetError,
  retryTarget,
  readBranch,
  activeTabId,
  onActiveTabChange,
  selectedFile,
  onSelectFile,
  repositoryBranchControl,
}: WorkspaceSessionToolsProps) {
  const directoryKey = JSON.stringify([repoPath, workingDirectory]);
  const viewRef = useRef<WorkspaceToolsView | null>(null);
  const owner = useMemo<Extract<DevServerOwner, { kind: "workspace_session" }>>(
    () => ({ kind: "workspace_session", workspaceId, sessionId }),
    [workspaceId, sessionId],
  );
  const { resolvedTarget, unavailableReason, isReady, refetchComparison } =
    useWorkspaceSessionComparison({
      isVisible,
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
    shouldBlockDiffLoading: !isVisible || workingDirectory === null || !isReady,
    isWorktreeResolutionResolving: false,
    worktreeResolutionError: null,
    retryWorktreeResolution,
    defaultTargetBranch: { branch: readTarget },
    branchIdentityKey: `${workingDirectory ?? ""}:${branchKey}`,
    enableScheduledRefresh: false,
  });
  // An in-flight diff can finish after the tools view closes.
  useGitCommentDraftValidation({
    commentOwner: owner,
    targetBranch: resolvedTarget,
    comparisonUnavailableReason: unavailableReason,
    scopeStatesByScope: diffData.scopeStatesByScope,
    loadedScopesByScope: diffData.loadedScopesByScope,
  });
  const { refresh, isFetchingTarget } = useWorkspaceSessionRefresh({
    isVisible,
    viewRef,
    branchKey,
    branchReady,
    diffData,
    refetchComparison,
    resolvedTarget,
    target,
    targetError,
    retryTarget,
    workingDirectory,
    repoPath,
  });
  const { manualRefresh, isWaitingForBranch } = useManualBranchRefresh({
    isVisible,
    directoryKey,
    viewRef,
    branchKey,
    branchReady,
    readBranch,
    refresh,
  });
  const refreshTools = useCallback(
    (scope: "git" | "all") => refresh("soft", scope === "all"),
    [refresh],
  );
  const refreshWhenVisible = useEffectEvent(() => {
    if (document.visibilityState === "visible") void refresh("scheduled");
  });
  useEffect(() => {
    if (!isVisible || !workingDirectory) return;
    globalThis.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      globalThis.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [isVisible, workingDirectory]);
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    viewRef.current = { isVisible, directoryKey, branchKey, refresh };
    return () => {
      viewRef.current = null;
    };
  }, [isVisible, directoryKey, branchKey, refresh]);
  const refreshDiffData = useCallback(async () => {
    // Completion invalidates the original directory. Only the current visible view reads again.
    if (workingDirectory) {
      await invalidateGitWorkingDirectoryQueries(queryClient, repoPath, workingDirectory);
    }
    const current = viewRef.current;
    if (
      current?.isVisible &&
      current.directoryKey === directoryKey &&
      current.branchKey === branchKey
    ) {
      await current.refresh("soft");
    }
  }, [branchKey, directoryKey, queryClient, repoPath, workingDirectory]);
  const conflictedFiles = useMemo(
    () => collectUnmergedFilePaths(diffData.fileStatuses),
    [diffData.fileStatuses],
  );
  const actions = useAgentStudioGitActions({
    onResolveGitConflict,
    assistanceContextKey: JSON.stringify([workspaceId, sessionId]),
    conflictRecipientLabel: "agent",
    conflictAssistanceBlockedReason,
    conflictAssistanceIsStarting,
    repoPath: workingDirectory ? repoPath : null,
    workingDir: workingDirectory,
    branch: branchReady ? diffData.branch : null,
    branchIdentityKey: branchKey,
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
    isDiffDataLoading: diffData.isLoading || !branchReady,
  });
  const fileModel = {
    ...workspaceFileModel({
      workingDirectory,
      resolvedTarget,
      isReady,
      branchReady,
      activeTabId,
      selectedFile,
      onSelectFile,
    }),
    branchKey,
  };
  const toolsContent = (
    <WorkspaceSessionGitTools
      key={JSON.stringify([repoPath, workingDirectory, branchKey])}
      commentOwner={owner}
      repoPath={repoPath}
      devServerOwner={owner}
      actions={actions}
      diffData={diffData}
      contextMode={contextMode}
      repositoryBranchControl={repositoryBranchControl}
      branchReady={branchReady}
      resolvedTarget={resolvedTarget}
      unavailableReason={unavailableReason}
      workingDirectory={workingDirectory}
      isFetchingTarget={isFetchingTarget || isWaitingForBranch}
      refresh={manualRefresh}
      tools={{
        tabs: [
          {
            id: "file_explorer",
            label: "File explorer",
            icon: FolderTree,
            content: <TaskExecutionFileExplorerPanel model={fileModel} />,
            keepMounted: true,
          },
        ],
        activeTabId,
        onActiveTabChange,
        tabListLabel: "Workspace session tools",
        testIdPrefix: "workspace-session-tools",
        headerActions: null,
      }}
    />
  );
  return { toolsContent, refresh: isVisible ? refreshTools : null };
}

const retryWorktreeResolution = (): void => undefined;

function workspaceFileModel({
  workingDirectory,
  resolvedTarget,
  isReady,
  branchReady,
  activeTabId,
  selectedFile,
  onSelectFile,
}: {
  workingDirectory: string | null;
  resolvedTarget: string | null;
  isReady: boolean;
  branchReady: boolean;
  activeTabId: WorkspaceToolsTabId;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
}): TaskExecutionFileExplorerPanelModel {
  let unavailableReason: string | null = null;
  if (!workingDirectory) {
    unavailableReason = missingWorkingDirectoryReason;
  } else if (!isReady && !branchReady) {
    unavailableReason = "Checking branch...";
  } else if (!isReady) {
    unavailableReason = "Checking comparison target...";
  }
  return {
    rootPath: workingDirectory,
    targetBranch: resolvedTarget,
    unavailableReason,
    isActive: activeTabId === "file_explorer" && isReady,
    selectedFile,
    onSelectFile,
  };
}

type WorkspaceRefresh = {
  refresh: (mode?: WorkspaceRefreshMode, includeFiles?: boolean) => Promise<void>;
  isFetchingTarget: boolean;
};

function useWorkspaceSessionRefresh({
  isVisible,
  viewRef,
  branchKey,
  branchReady,
  diffData,
  refetchComparison,
  resolvedTarget,
  target,
  targetError,
  retryTarget,
  workingDirectory,
  repoPath,
}: {
  isVisible: boolean;
  viewRef: RefObject<WorkspaceToolsView | null>;
  branchKey: string;
  branchReady: boolean;
  diffData: ReturnType<typeof useAgentStudioDiffData>;
  refetchComparison: WorkspaceComparison["refetchComparison"];
  resolvedTarget: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  retryTarget: () => Promise<void>;
  workingDirectory: string | null;
  repoPath: string;
}): WorkspaceRefresh {
  const directoryKey = JSON.stringify([repoPath, workingDirectory]);
  const scopeKey = JSON.stringify([repoPath, workingDirectory, branchKey]);
  const queryClient = useQueryClient();
  const { refresh: refreshDiff, refreshInactiveScope, refreshAllScopes } = diffData;
  const [isFetchingTarget, setIsFetchingTarget] = useState(false);
  const [retry, setRetry] = useState<{ scopeKey: string } | null>(null);
  const handledRetry = useRef<typeof retry>(null);
  const refresh = useCallback(
    async (mode: WorkspaceRefreshMode = "hard", includeFiles = true) => {
      // Recheck the live view after each read, since it can close or change while we wait.
      const canRead = () =>
        viewRef.current?.isVisible === true &&
        viewRef.current.directoryKey === directoryKey &&
        viewRef.current.branchKey === branchKey;
      if (!branchReady || !canRead()) return;
      const fetchTarget =
        mode === "hard" &&
        !!workingDirectory &&
        (targetError !== null || (!resolvedTarget && !!target));
      if (fetchTarget) setIsFetchingTarget(true);
      try {
        if (mode === "hard" && targetError) {
          await retryTarget();
          if (
            viewRef.current?.directoryKey === directoryKey &&
            viewRef.current.branchKey === branchKey
          ) {
            setRetry({ scopeKey });
          }
          return;
        }
        await refreshWorkspaceSessionData({
          queryClient,
          diffData: {
            refresh: refreshDiff,
            refreshInactiveScope,
            refreshAllScopes,
            diffScope: diffData.diffScope,
          },
          branchKey,
          refetchComparison,
          resolvedTarget,
          target,
          targetError,
          workingDirectory,
          repoPath,
          mode,
          includeFiles,
          canRead,
        });
      } catch (error) {
        toast.error("Could not refresh Git changes", { description: errorMessage(error) });
      } finally {
        setIsFetchingTarget(false);
      }
    },
    [
      branchReady,
      branchKey,
      refreshDiff,
      refreshInactiveScope,
      refreshAllScopes,
      diffData.diffScope,
      queryClient,
      refetchComparison,
      resolvedTarget,
      target,
      targetError,
      retryTarget,
      workingDirectory,
      repoPath,
      scopeKey,
      directoryKey,
      viewRef,
    ],
  );
  useEffect(() => {
    if (retry === null || retry === handledRetry.current) return;
    if (retry.scopeKey !== scopeKey) {
      handledRetry.current = retry;
      return;
    }
    if (!isVisible || targetError) return;
    // Use the target from the render after the settings read succeeds.
    handledRetry.current = retry;
    void refresh("hard");
  }, [isVisible, refresh, retry, scopeKey, targetError]);
  return { refresh, isFetchingTarget };
}

type ManualBranchRefresh = {
  manualRefresh: () => Promise<void>;
  isWaitingForBranch: boolean;
};

function useManualBranchRefresh({
  isVisible,
  directoryKey,
  viewRef,
  branchKey,
  branchReady,
  readBranch,
  refresh,
}: {
  isVisible: boolean;
  directoryKey: string;
  viewRef: RefObject<WorkspaceToolsView | null>;
  branchKey: string;
  branchReady: boolean;
  readBranch: () => Promise<string>;
  refresh: WorkspaceRefresh["refresh"];
}): ManualBranchRefresh {
  const [pending, setPending] = useState<{ directoryKey: string; branchKey: string } | null>(null);
  const activeRefresh = useRef<typeof pending>(null);
  const lastBranch = useRef(branchKey);
  const manualRefresh = useCallback(async () => {
    if (!viewRef.current?.isVisible || viewRef.current.directoryKey !== directoryKey) return;
    try {
      const nextBranchKey = await readBranch();
      const current = viewRef.current;
      if (current?.directoryKey !== directoryKey) return;
      if (current.branchKey !== branchKey && current.branchKey !== nextBranchKey) return;
      if (nextBranchKey !== branchKey || !current.isVisible) {
        setPending({ directoryKey, branchKey: nextBranchKey });
        return;
      }
      await refresh("hard");
    } catch (error) {
      toast.error("Could not refresh Git changes", { description: errorMessage(error) });
    }
  }, [branchKey, directoryKey, readBranch, refresh, viewRef]);
  useEffect(() => {
    const branchChanged = lastBranch.current !== branchKey;
    lastBranch.current = branchKey;
    if (pending === null) return;
    if (
      pending.directoryKey !== directoryKey ||
      (branchChanged && pending.branchKey !== branchKey)
    ) {
      setPending(null);
      return;
    }
    if (
      !isVisible ||
      !branchReady ||
      pending.branchKey !== branchKey ||
      activeRefresh.current === pending
    )
      return;
    // The branch query changes the comparison key on the next render.
    activeRefresh.current = pending;
    void refresh("hard", false).finally(() => {
      if (activeRefresh.current === pending) activeRefresh.current = null;
      setPending((current) => (current === pending ? null : current));
    });
  }, [isVisible, directoryKey, branchKey, branchReady, pending, refresh]);
  return { manualRefresh, isWaitingForBranch: pending?.directoryKey === directoryKey };
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

async function refreshWorkspaceSessionData(input: {
  queryClient: QueryClient;
  diffData: Pick<
    ReturnType<typeof useAgentStudioDiffData>,
    "refresh" | "refreshInactiveScope" | "refreshAllScopes" | "diffScope"
  >;
  branchKey: string;
  refetchComparison: WorkspaceComparison["refetchComparison"];
  resolvedTarget: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  workingDirectory: string | null;
  repoPath: string;
  mode: WorkspaceRefreshMode;
  includeFiles: boolean;
  canRead: () => boolean;
}): Promise<void> {
  const {
    queryClient,
    diffData,
    branchKey,
    refetchComparison,
    resolvedTarget,
    target,
    targetError,
    workingDirectory,
    repoPath,
    mode,
    includeFiles,
    canRead,
  } = input;
  if (!canRead()) return;
  if (workingDirectory && target && !targetError) {
    if (mode === "hard" && !resolvedTarget) {
      try {
        await hostClient.gitFetchRemote(repoPath, canonicalTargetBranch(target), workingDirectory);
      } catch (error) {
        toast.error("Could not refresh Git changes", { description: errorMessage(error) });
      }
    }
    if (!canRead()) return;
    const checkedComparison = await refetchComparison();
    if (!canRead()) return;
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
    if (!canRead()) return;
    if (!resolvedTarget) {
      await diffData.refresh("soft");
      return;
    }
    if (mode === "hard") {
      await diffData.refresh("hard");
      if (!canRead()) return;
      await diffData.refreshInactiveScope();
      return;
    }
    if (mode === "scheduled") {
      await diffData.refresh("scheduled");
      return;
    }
    await diffData.refreshAllScopes();
  };
  if (includeFiles && workingDirectory) {
    await refreshWorkspaceFileQueries(
      queryClient,
      workingDirectory,
      mode === "hard" ? "full" : "incremental",
      {
        consumer: diffData.refresh,
        context: JSON.stringify([repoPath, resolvedTarget, branchKey, diffData.diffScope]),
        priority: gitRefreshPriority(mode),
        mayFetch: resolvedTarget !== null && mode !== "soft",
        run: refreshGit,
      },
    );
  } else {
    await refreshGit();
  }
}

type WorkspaceComparison = {
  resolvedTarget: string | null;
  isReady: boolean;
  unavailableReason: string | null;
  refetchComparison: () => Promise<{
    isError: boolean;
    data: GitComparisonTarget | undefined;
  }>;
};

function useWorkspaceSessionComparison(input: {
  isVisible: boolean;
  repoPath: string;
  workingDirectory: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  branchKey: string;
  branchReady: boolean;
}): WorkspaceComparison {
  const { isVisible, repoPath, workingDirectory, target, targetError, branchKey, branchReady } =
    input;
  const hasComparisonTarget =
    branchReady && Boolean(workingDirectory) && target !== null && targetError === null;
  const comparison = useQuery({
    ...gitComparisonTargetQueryOptions(
      repoPath,
      workingDirectory ?? "__missing_working_directory__",
      target ?? { branch: "HEAD" },
      branchKey,
    ),
    enabled: isVisible && hasComparisonTarget,
  });
  const resolvedTarget =
    hasComparisonTarget && !comparison.isError && comparison.data?.kind === "available"
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

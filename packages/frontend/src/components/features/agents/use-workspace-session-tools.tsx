import type { ResolveGitConflict } from "@/features/git-conflict-resolution/conflict-assistance";
import {
  useSessionComparison,
  useSessionComparisonControl,
} from "@/features/agent-studio-git/use-session-comparison";
import { buildComparisonView } from "@/features/agent-studio-git/session-comparison-view";
import type { DevServerOwner, GitTargetBranch } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
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
import { canonicalTargetBranch } from "@/lib/target-branch";
import { filesystemQueryKeys, refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import { invalidateGitWorkingDirectoryQueries } from "@/state/queries/git";
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
  branchError?: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  applyTarget: (target: GitTargetBranch) => Promise<void>;
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
  contextKey: string;
  ownerKey: string;
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
  branchError,
  applyTarget,
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
  const ownerKey = JSON.stringify([workspaceId, sessionId]);
  const viewRef = useRef<WorkspaceToolsView | null>(null);
  const owner = useMemo<Extract<DevServerOwner, { kind: "workspace_session" }>>(
    () => ({ kind: "workspace_session", workspaceId, sessionId }),
    [workspaceId, sessionId],
  );
  const comparison = useSessionComparison({
    enabled: isVisible,
    viewKey: JSON.stringify([workspaceId, sessionId]),
    repoPath,
    workingDirectory,
    target,
    targetError,
    branchKey,
    branchReady,
    branchError: branchError ?? null,
  });
  const { resolvedTarget, refreshComparison, contextKey } = comparison;
  const control = useSessionComparisonControl({
    repoPath,
    target,
    editable: isVisible,
    allowUpstream: contextMode === "repository",
    applyTarget,
    helpText:
      "This choice applies only to this session. It resets on app reload or successful archive.",
  });
  const readTarget = resolvedTarget ?? "HEAD";
  const reads = useAgentStudioDiffData({
    repoPath: workingDirectory ? repoPath : null,
    worktreePath: workingDirectory,
    worktreeResolutionTaskId: null,
    shouldBlockDiffLoading: !isVisible || workingDirectory === null || !branchReady,
    isWorktreeResolutionResolving: false,
    worktreeResolutionError: null,
    retryWorktreeResolution,
    comparisonReference: readTarget,
    defaultTargetBranch: { branch: readTarget },
    branchIdentityKey: comparison.contextKey,
    enableScheduledRefresh: false,
  });
  const diffData = buildComparisonView(
    reads,
    comparison,
    target ? canonicalTargetBranch(target) : "Default target pending",
  );
  const unavailableReason = diffData.comparisonUnavailableReason;
  const markerTarget = diffData.comparisonReference;
  // An in-flight diff can finish after the tools view closes.
  useGitCommentDraftValidation({
    commentOwner: owner,
    targetBranch: resolvedTarget,
    comparisonUnavailableReason: unavailableReason,
    scopeStatesByScope: diffData.scopeStatesByScope,
    loadedScopesByScope: diffData.loadedScopesByScope,
  });
  const { refreshInactiveScope } = reads;
  useEffect(() => {
    if (isVisible && resolvedTarget) void refreshInactiveScope();
  }, [isVisible, resolvedTarget, refreshInactiveScope]);
  const { refresh, isFetchingTarget } = useWorkspaceSessionRefresh({
    isVisible,
    viewRef,
    branchKey,
    contextKey,
    ownerKey,
    branchReady,
    diffData,
    refreshComparison,
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
    viewRef.current = { isVisible, directoryKey, branchKey, contextKey, ownerKey, refresh };
    return () => {
      viewRef.current = null;
    };
  }, [isVisible, directoryKey, branchKey, contextKey, ownerKey, refresh]);
  const refreshDiffData = useCallback(async () => {
    // Completion invalidates the original directory. Only the current visible view reads again.
    if (workingDirectory) {
      await invalidateGitWorkingDirectoryQueries(queryClient, repoPath, workingDirectory);
    }
    const current = viewRef.current;
    if (
      current?.isVisible &&
      current.directoryKey === directoryKey &&
      current.contextKey === contextKey
    ) {
      await current.refresh("soft");
    }
  }, [contextKey, directoryKey, queryClient, repoPath, workingDirectory]);
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
    contextKey,
    targetBranch: markerTarget ?? "",
    resetTargetBranch: "HEAD",
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
      resolvedTarget: markerTarget,
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
      resolvedTarget={markerTarget}
      control={control}
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
        activeTabId: activeTabId,
        onActiveTabChange: onActiveTabChange,
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
  branchReady,
  activeTabId,
  selectedFile,
  onSelectFile,
}: {
  workingDirectory: string | null;
  resolvedTarget: string | null;
  branchReady: boolean;
  activeTabId: WorkspaceToolsTabId;
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
    isActive: activeTabId === "file_explorer" && branchReady,
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
  contextKey,
  ownerKey,
  diffData,
  refreshComparison,
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
  contextKey: string;
  ownerKey: string;
  diffData: ReturnType<typeof useAgentStudioDiffData>;
  refreshComparison: ReturnType<typeof useSessionComparison>["refreshComparison"];
  resolvedTarget: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  retryTarget: () => Promise<void>;
  workingDirectory: string | null;
  repoPath: string;
}): WorkspaceRefresh {
  const directoryKey = JSON.stringify([repoPath, workingDirectory]);
  const scopeKey = JSON.stringify([directoryKey, branchKey, ownerKey]);
  const queryClient = useQueryClient();
  const { refresh: refreshDiff, refreshInactiveScope, refreshAllScopes } = diffData;
  const [isFetchingTarget, setIsFetchingTarget] = useState(false);
  const [retry, setRetry] = useState<{ scopeKey: string; target: string | null } | null>(null);
  const handledRetry = useRef<typeof retry>(null);
  const refresh = useCallback(
    async (mode: WorkspaceRefreshMode = "hard", includeFiles = true) => {
      // Recheck the live view after each read, since it can close or change while we wait.
      const canRead = () =>
        viewRef.current?.isVisible === true &&
        viewRef.current.directoryKey === directoryKey &&
        viewRef.current.contextKey === contextKey;
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
            viewRef.current.branchKey === branchKey &&
            viewRef.current.ownerKey === ownerKey
          ) {
            setRetry({ scopeKey, target: target ? JSON.stringify(target) : null });
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
          branchKey: contextKey,
          refreshComparison,
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
        if (!canRead()) return;
        await refreshDiff("soft");
        toast.error("Could not refresh Git changes", { description: errorMessage(error) });
      } finally {
        setIsFetchingTarget(false);
      }
    },
    [
      branchReady,
      branchKey,
      contextKey,
      ownerKey,
      refreshDiff,
      refreshInactiveScope,
      refreshAllScopes,
      diffData.diffScope,
      queryClient,
      refreshComparison,
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
    if (
      retry.scopeKey !== scopeKey ||
      (retry.target !== null && retry.target !== JSON.stringify(target))
    ) {
      handledRetry.current = retry;
      return;
    }
    if (!isVisible || targetError) return;
    // Use the target from the render after the settings read succeeds.
    handledRetry.current = retry;
    void refresh("hard");
  }, [isVisible, refresh, retry, scopeKey, target, targetError]);
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

async function refreshWorkspaceSessionData(input: {
  queryClient: QueryClient;
  diffData: Pick<
    ReturnType<typeof useAgentStudioDiffData>,
    "refresh" | "refreshInactiveScope" | "refreshAllScopes" | "diffScope"
  >;
  branchKey: string;
  refreshComparison: ReturnType<typeof useSessionComparison>["refreshComparison"];
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
    refreshComparison,
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
    const checkedTarget = await refreshComparison(mode);
    if (!canRead()) return;
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
    await diffData.refreshAllScopes(mode === "scheduled" ? "summary" : "full");
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

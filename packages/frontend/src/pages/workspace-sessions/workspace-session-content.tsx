import type { GitTargetBranch, WorkspaceSession } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import {
  useWorkspaceSessionTools,
  type WorkspaceToolsTabId,
} from "@/components/features/agents/use-workspace-session-tools";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { useAgentSessionReadModelState, useWorkspaceBranchState } from "@/state/app-state-provider";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import { invalidateGitWorkingDirectoryQueries } from "@/state/queries/git";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessionChatPanes } from "./workspace-session-chat-panes";
import { workspaceSessionWorkingDirectory } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import {
  WorkspaceSessionFilePreview,
  type WorkspaceSessionFilePreviewHandle,
} from "./workspace-session-file-preview";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";
import { RepositoryBranchSwitcher } from "@/components/features/repository/repository-branch-switcher";

export type WorkspaceSessionPanelState = {
  isOpen: boolean;
  activeTabId: WorkspaceToolsTabId;
  selectedFile: TaskExecutionSelectedFile | null;
};

export function WorkspaceSessionContent({
  workspace,
  record,
  sessionIds,
  panelState,
  onPanelStateChange: changePanel,
  onSafeToLeave,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  sessionIds: readonly string[];
  panelState: WorkspaceSessionPanelState;
  onPanelStateChange: (
    sessionId: string,
    update: Partial<Pick<WorkspaceSessionPanelState, "activeTabId" | "selectedFile">>,
  ) => void;
  onSafeToLeave?: () => void;
}) {
  const onPanelStateChange = useCallback(
    (update: Partial<Pick<WorkspaceSessionPanelState, "activeTabId" | "selectedFile">>) =>
      changePanel(record.id, update),
    [changePanel, record.id],
  );
  const { activeBranch, isSwitchingBranch } = useWorkspaceBranchState();
  const repoConfig = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const queryClient = useQueryClient();
  const workingDirectory = workspaceSessionWorkingDirectory(workspace, record);
  const isWorktree = record.executionTarget.kind === "local_worktree";
  const branch = useWorkspaceSessionBranch({
    repoPath: workspace.repoPath,
    workingDirectory,
    isWorktree,
    isSwitchingBranch,
    activeBranch,
  });
  const { rootBranch, branchKey, branchReady, refreshBranch, readBranch } = branch;
  const previewRef = useRef<WorkspaceSessionFilePreviewHandle | null>(null);
  const refreshRef = useRef<((scope: "git" | "all") => Promise<void>) | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateLayout = () => setIsNarrow(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);
  const target: GitTargetBranch | null = useMemo(
    () =>
      record.executionTarget.kind === "local_repo_root"
        ? { branch: "@{upstream}" }
        : (repoConfig.data?.defaultTargetBranch ?? null),
    [record.executionTarget.kind, repoConfig.data?.defaultTargetBranch],
  );
  const targetError =
    record.executionTarget.kind === "local_worktree" && repoConfig.isError
      ? `Could not read the default target branch: ${errorMessage(repoConfig.error)}`
      : null;
  const refreshAfterChange = useCallback(
    (scope: "git" | "all") => {
      if (isWorktree || scope === "all") refreshBranch();
      const refresh = refreshRef.current;
      if (workingDirectory && (scope === "git" || !refresh)) {
        void invalidateGitWorkingDirectoryQueries(
          queryClient,
          workspace.repoPath,
          workingDirectory,
        );
      }
      if (workingDirectory && scope === "all" && !refresh) {
        // File queries render their own refresh errors.
        void refreshWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
      }
      void refresh?.(scope);
    },
    [isWorktree, queryClient, refreshBranch, workingDirectory, workspace.repoPath],
  );
  const onSelectFile = useCallback((file: TaskExecutionSelectedFile) => {
    const actions = previewRef.current;
    if (!actions) throw new Error("The file preview is not ready. Open the chat again.");
    return actions.onSelectFile(file);
  }, []);
  const onFileSaved = useCallback(() => refreshAfterChange("all"), [refreshAfterChange]);
  const onToolRefresh = useCallback(() => refreshAfterChange("all"), [refreshAfterChange]);
  const { refetch: refetchConfig } = repoConfig;
  const retryTarget = useCallback(async () => {
    const result = await refetchConfig();
    if (result.isError) throw result.error;
  }, [refetchConfig]);
  const onSelectionChange = useCallback(
    (selectedFile: TaskExecutionSelectedFile | null) => onPanelStateChange({ selectedFile }),
    [onPanelStateChange],
  );
  const onActiveTabChange = useCallback(
    (activeTabId: WorkspaceToolsTabId) => onPanelStateChange({ activeTabId }),
    [onPanelStateChange],
  );
  const previewContent = (
    <WorkspaceSessionFilePreview
      key={record.id}
      ref={previewRef}
      initialFile={panelState.selectedFile}
      onSelectionChange={onSelectionChange}
      onSafeToLeave={onSafeToLeave}
      isWorktree={isWorktree}
      branch={branch}
      hasRootBranch={rootBranch.data !== undefined || activeBranch !== null}
      onFileSaved={onFileSaved}
    />
  );
  const mainContent = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {previewContent}
        <div
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          style={{ visibility: panelState.selectedFile ? "hidden" : undefined }}
          inert={panelState.selectedFile !== null}
        >
          <WorkspaceSessionChatPanes
            workspace={workspace}
            record={record}
            sessionIds={sessionIds}
            onToolRefresh={onToolRefresh}
            onSelectFile={onSelectFile}
            workingDirectory={workingDirectory}
            branchKey={branchKey}
          />
        </div>
      </div>
    </div>
  );
  const { toolsContent, refresh: refreshTools } = useWorkspaceSessionTools({
    isVisible: panelState.isOpen,
    repoPath: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    sessionId: record.id,
    workingDirectory,
    contextMode: record.executionTarget.kind === "local_repo_root" ? "repository" : "worktree",
    repositoryBranchControl: <RepositoryBranchSwitcher layout="inline" />,
    branchKey,
    branchReady,
    target,
    targetError,
    readBranch,
    retryTarget,
    activeTabId: panelState.activeTabId,
    onActiveTabChange,
    selectedFile: panelState.selectedFile,
    onSelectFile,
  });
  useLayoutEffect(() => {
    refreshRef.current = refreshTools;
    return () => {
      refreshRef.current = null;
    };
  }, [refreshTools]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <WorkspaceSessionPaneLayout
        isOpen={panelState.isOpen}
        isNarrow={isNarrow}
        mainContent={mainContent}
        toolsContent={toolsContent}
      />
    </div>
  );
}

export function WorkspaceSessionReadModelNotice() {
  const { sessionReadModelLoadState, workspaceSessionRecordsError, reloadSessionReadModel } =
    useAgentSessionReadModelState();
  const error =
    sessionReadModelLoadState.kind === "failed"
      ? sessionReadModelLoadState.message
      : workspaceSessionRecordsError;
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-border p-3 text-sm">
      <span className="flex-1 text-destructive">Session data unavailable: {error}</span>
      <Button size="sm" variant="outline" onClick={reloadSessionReadModel}>
        Retry
      </Button>
    </div>
  );
}

function WorkspaceSessionPaneLayout({
  isOpen,
  isNarrow,
  mainContent,
  toolsContent,
}: {
  isOpen: boolean;
  isNarrow: boolean;
  mainContent: ReactNode;
  toolsContent: ReactNode;
}) {
  return (
    <ResizablePanelGroup
      direction={isNarrow ? "vertical" : "horizontal"}
      className="h-full min-h-0 overflow-hidden"
    >
      <ResizablePanel defaultSize={isNarrow ? 55 : 63} minSize={isNarrow ? 30 : 35}>
        {mainContent}
      </ResizablePanel>
      {isOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={isNarrow ? 45 : 37} minSize={isNarrow ? 25 : 30}>
            <div className="h-full min-h-0 overflow-hidden border-l border-border bg-card">
              {toolsContent}
            </div>
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

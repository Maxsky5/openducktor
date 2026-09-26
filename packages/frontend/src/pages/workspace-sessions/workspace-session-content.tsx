import type { GitTargetBranch, WorkspaceSession } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { TaskExecutionSelectedFilePreview } from "@/components/features/agents/task-execution-file-preview";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import {
  WorkspaceSessionToolsPanel,
  type WorkspaceToolsTabId,
} from "@/components/features/agents/workspace-session-tools-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/errors";
import { useAgentSessionReadModelState, useWorkspaceBranchState } from "@/state/app-state-provider";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import { invalidateGitWorkingDirectoryQueries } from "@/state/queries/git";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessionChat } from "./workspace-session-chat";
import { WorkspaceSessionHeader } from "./workspace-session-header";
import { useWorkspaceSessionPreview } from "./use-workspace-session-preview";
import { usePreviewBranchKey } from "./use-preview-branch-key";

export type WorkspaceSessionPanelState = {
  isOpen: boolean;
  activeTabId: WorkspaceToolsTabId;
  selectedFile: TaskExecutionSelectedFile | null;
};

function WorkspaceSessionChatPane({
  workspace,
  record,
  onToolRefresh,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  onToolRefresh: () => void;
}) {
  const settings = useQuery(settingsSnapshotQueryOptions());
  if (settings.isPending)
    return (
      <p role="status" className="p-4">
        Loading chat settings…
      </p>
    );
  if (settings.isError)
    return (
      <div role="alert" className="p-4">
        <p className="text-destructive">{errorMessage(settings.error)}</p>
        <Button onClick={() => void settings.refetch()}>Retry settings</Button>
      </div>
    );
  return (
    <WorkspaceSessionChat
      workspace={workspace}
      record={record}
      chatSettings={settings.data.chat}
      reusablePrompts={settings.data.reusablePrompts}
      onToolRefresh={onToolRefresh}
    />
  );
}

function sessionWorkingDirectory(
  workspace: ActiveWorkspace,
  record: WorkspaceSession,
): string | null {
  return record.executionTarget.kind === "local_repo_root"
    ? workspace.repoPath || null
    : record.executionTarget.workingDirectory || null;
}

function WorkspaceSessionMainContent({
  workspace,
  record,
  onToolRefresh,
  previewContent,
  hasSelectedFile,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  onToolRefresh: () => void;
  previewContent: ReactNode;
  hasSelectedFile: boolean;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {hasSelectedFile ? (
        <div
          className="absolute inset-0 z-10 h-full min-h-0 overflow-hidden"
          data-testid="workspace-session-file-preview"
        >
          {previewContent}
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{ visibility: hasSelectedFile ? "hidden" : undefined }}
        inert={hasSelectedFile}
      >
        <WorkspaceSessionChatPane
          workspace={workspace}
          record={record}
          onToolRefresh={onToolRefresh}
        />
      </div>
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
  if (!isOpen) return mainContent;
  return (
    <ResizablePanelGroup
      direction={isNarrow ? "vertical" : "horizontal"}
      className="h-full min-h-0 overflow-hidden"
    >
      <ResizablePanel defaultSize={isNarrow ? 55 : 63} minSize={isNarrow ? 30 : 35}>
        {mainContent}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={isNarrow ? 45 : 37} minSize={isNarrow ? 25 : 30}>
        <div className="h-full min-h-0 overflow-hidden border-l border-border bg-card">
          {toolsContent}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
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

export function WorkspaceSessionContent({
  workspace,
  record,
  panelState,
  onPanelStateChange,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  panelState: WorkspaceSessionPanelState;
  onPanelStateChange: (update: Partial<WorkspaceSessionPanelState>) => void;
}) {
  const { activeBranch } = useWorkspaceBranchState();
  const repoConfig = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const queryClient = useQueryClient();
  const onSelectionChange = useCallback(
    (selectedFile: TaskExecutionSelectedFile | null) => onPanelStateChange({ selectedFile }),
    [onPanelStateChange],
  );
  const { preview, onDiscard } = useWorkspaceSessionPreview(
    panelState.selectedFile,
    onSelectionChange,
  );
  const refreshRef = useRef<((scope: "git" | "all") => Promise<void>) | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateLayout = () => setIsNarrow(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);
  const workingDirectory = sessionWorkingDirectory(workspace, record);
  const branchKey =
    record.executionTarget.kind === "local_repo_root"
      ? (activeBranch?.name ?? (activeBranch?.detached ? "detached" : "unknown"))
      : "";
  const branchReady = activeBranch?.detached === true || activeBranch?.name != null;
  const previewBranch =
    record.executionTarget.kind === "local_repo_root" && branchReady ? branchKey : null;
  const previewBranchKey = usePreviewBranchKey(previewBranch);
  const target: GitTargetBranch | null =
    record.executionTarget.kind === "local_repo_root"
      ? { branch: "@{upstream}" }
      : (repoConfig.data?.defaultTargetBranch ?? null);
  const targetError =
    record.executionTarget.kind === "local_worktree" && repoConfig.isError
      ? `Could not read the default target branch: ${errorMessage(repoConfig.error)}`
      : null;
  const onRefreshReady = useCallback(
    (refresh: ((scope: "git" | "all") => Promise<void>) | null) => {
      refreshRef.current = refresh;
    },
    [],
  );
  const refreshAfterChange = useCallback(
    (scope: "git" | "all") => {
      const refresh = refreshRef.current;
      if (workingDirectory && (scope === "git" || !refresh)) {
        void invalidateGitWorkingDirectoryQueries(
          queryClient,
          workspace.repoPath,
          workingDirectory,
        );
      }
      void refresh?.(scope);
    },
    [queryClient, workingDirectory, workspace.repoPath],
  );
  const onSelectFile = useCallback(
    (file: TaskExecutionSelectedFile) => preview.onSelectFile(file),
    [preview],
  );
  const previewContent = (
    <TaskExecutionSelectedFilePreview
      key={`${preview.model.previewSessionKey}:${previewBranchKey}`}
      model={{
        ...preview.model,
        onDiscard,
      }}
      onFileSaved={() => refreshAfterChange("git")}
    />
  );
  const mainContent = (
    <WorkspaceSessionMainContent
      workspace={workspace}
      record={record}
      onToolRefresh={() => refreshAfterChange("all")}
      previewContent={previewContent}
      hasSelectedFile={Boolean(preview.model.selectedFile)}
    />
  );
  const toolsContent = (
    <WorkspaceSessionToolsPanel
      repoPath={workspace.repoPath}
      workingDirectory={workingDirectory}
      contextMode={record.executionTarget.kind === "local_repo_root" ? "repository" : "worktree"}
      branchKey={branchKey}
      target={target}
      targetError={targetError}
      retryTarget={async () => {
        const result = await repoConfig.refetch();
        if (result.isError) throw result.error;
      }}
      activeTabId={panelState.activeTabId}
      onActiveTabChange={(activeTabId) => onPanelStateChange({ activeTabId })}
      selectedFile={preview.model.selectedFile}
      onSelectFile={onSelectFile}
      onRefreshReady={onRefreshReady}
    />
  );
  return (
    <TabsContent
      value={record.id}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card"
    >
      <WorkspaceSessionHeader workspaceId={workspace.workspaceId} record={record} />
      <WorkspaceSessionPaneLayout
        isOpen={panelState.isOpen}
        isNarrow={isNarrow}
        mainContent={mainContent}
        toolsContent={toolsContent}
      />
    </TabsContent>
  );
}

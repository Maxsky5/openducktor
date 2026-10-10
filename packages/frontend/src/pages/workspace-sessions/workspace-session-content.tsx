import type { WorkspaceSession } from "@openducktor/contracts";
import { type ReactElement, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { useWorkspaceSessionTools } from "@/components/features/agents/use-workspace-session-tools";
import { RepositoryBranchSwitcher } from "@/components/features/repository/repository-branch-switcher";
import { Button } from "@/components/ui/button";
import type { ResolveGitConflict } from "@/features/git-conflict-resolution/conflict-assistance";
import {
  SessionPanel,
  type SessionPanelModel,
  SessionPanelSplit,
  type SessionPanelSplitIds,
  type SessionPanelSplitSizes,
  type ToolTabViews,
  useNarrowWindow,
} from "@/features/session-panels";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { WorkspaceConflictChatActions } from "./use-workspace-conflict-chat-actions";
import {
  requestWorkspaceGitConflictAssistance,
  workspaceConflictChatKey,
} from "./workspace-git-conflict-assistance";
import { useWorkspaceSessionGit } from "./use-workspace-session-git";
import { WorkspaceSessionChatPanes } from "./workspace-session-chat-panes";
import {
  WorkspaceSessionFilePreview,
  type WorkspaceSessionFilePreviewHandle,
} from "./workspace-session-file-preview";

const TOOLS_PANEL_SPLIT_IDS: SessionPanelSplitIds = {
  group: "workspace-session-tools-layout",
  main: "workspace-session-main-panel",
  panel: "workspace-session-tools-panel",
};
const TOOLS_PANEL_SIZES: SessionPanelSplitSizes = {
  main: 63,
  mainMin: "35%",
  panel: 37,
  panelMin: "30%",
};
const NARROW_TOOLS_PANEL_SIZES: SessionPanelSplitSizes = {
  main: 55,
  mainMin: "30%",
  panel: 45,
  panelMin: "25%",
};

type WorkspaceSessionContentProps = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  sessionIds: readonly string[];
  rightPanel: SessionPanelModel;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectedFileChange: (sessionId: string, selectedFile: TaskExecutionSelectedFile | null) => void;
  onSafeToLeave?: () => void;
};

export function WorkspaceSessionContent({
  workspace,
  record,
  sessionIds,
  rightPanel,
  selectedFile,
  onSelectedFileChange,
  onSafeToLeave,
}: WorkspaceSessionContentProps): ReactElement {
  const isPanelOpen = rightPanel.isVisible;
  const [chatActions, setChatActions] = useState<WorkspaceConflictChatActions | null>(null);
  const selectedKey = workspaceConflictChatKey(workspace.workspaceId, record.id);
  const onActionsReady = useCallback(
    (ownerKey: string, actions: WorkspaceConflictChatActions | null) => {
      if (ownerKey !== selectedKey) return;
      if (actions) setChatActions(actions);
      else
        setChatActions((current) =>
          current &&
          workspaceConflictChatKey(current.workspace.workspaceId, current.record.id) === ownerKey
            ? null
            : current,
        );
    },
    [selectedKey],
  );
  const assistance =
    chatActions?.record.id === record.id &&
    chatActions.workspace.workspaceId === workspace.workspaceId &&
    chatActions.workspace.repoPath === workspace.repoPath
      ? chatActions
      : null;
  const onResolveGitConflict: ResolveGitConflict = (conflict, assertCurrent = () => {}) =>
    requestWorkspaceGitConflictAssistance({
      workspace,
      record,
      actions: assistance,
      conflict,
      assertCurrent,
    });
  const {
    branch,
    workingDirectory,
    isWorktree,
    hasRootBranch,
    branchError,
    target,
    targetError,
    applyTarget,
    retryTarget,
    refreshAfterChange,
    refreshRef,
  } = useWorkspaceSessionGit({ workspace, record, isPanelOpen });
  const { branchKey, branchReady, readBranch } = branch;
  const previewRef = useRef<WorkspaceSessionFilePreviewHandle | null>(null);
  const isNarrow = useNarrowWindow();
  const onSelectFile = useCallback((file: TaskExecutionSelectedFile) => {
    const actions = previewRef.current;
    if (!actions) throw new Error("The file preview is not ready. Open the chat again.");
    return actions.onSelectFile(file);
  }, []);
  const onFileSaved = useCallback(() => refreshAfterChange("all"), [refreshAfterChange]);
  const onToolRefresh = useCallback(() => refreshAfterChange("all"), [refreshAfterChange]);
  const onSelectionChange = useCallback(
    (file: TaskExecutionSelectedFile | null) => onSelectedFileChange(record.id, file),
    [onSelectedFileChange, record.id],
  );
  const previewContent = (
    <WorkspaceSessionFilePreview
      key={record.id}
      ref={previewRef}
      initialFile={selectedFile}
      onSelectionChange={onSelectionChange}
      onSafeToLeave={onSafeToLeave}
      isWorktree={isWorktree}
      branch={branch}
      hasRootBranch={hasRootBranch}
      onFileSaved={onFileSaved}
    />
  );
  const mainContent = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {previewContent}
        <div
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          style={{ visibility: selectedFile ? "hidden" : undefined }}
          inert={selectedFile !== null}
        >
          <WorkspaceSessionChatPanes
            workspace={workspace}
            record={record}
            sessionIds={sessionIds}
            onToolRefresh={onToolRefresh}
            onSelectFile={onSelectFile}
            workingDirectory={workingDirectory}
            branchKey={branchKey}
            onActionsReady={onActionsReady}
          />
        </div>
      </div>
    </div>
  );
  const {
    diffsContent,
    filesContent,
    refresh: refreshTools,
  } = useWorkspaceSessionTools({
    isVisible: isPanelOpen,
    onResolveGitConflict,
    conflictAssistanceBlockedReason:
      assistance?.blockedReason ??
      (assistance ? null : "Wait for the selected chat to load, or reload session data."),
    conflictAssistanceIsStarting: assistance?.isStarting ?? false,
    repoPath: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    sessionId: record.id,
    workingDirectory,
    contextMode: record.executionTarget.kind === "local_repo_root" ? "repository" : "worktree",
    repositoryBranchControl: <RepositoryBranchSwitcher layout="inline" />,
    branchKey,
    currentBranch: branch.currentBranch,
    branchReady,
    branchError,
    applyTarget,
    target,
    targetError,
    readBranch,
    retryTarget,
    isFilesActive: rightPanel.activeKind === "files",
    selectedFile,
    onSelectFile,
  });
  const toolTabs: ToolTabViews = {
    diffs: { content: diffsContent },
    files: { content: filesContent },
  };
  useLayoutEffect(() => {
    refreshRef.current = refreshTools;
    return () => {
      refreshRef.current = null;
    };
  }, [refreshRef, refreshTools]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <SessionPanelSplit
        ids={TOOLS_PANEL_SPLIT_IDS}
        model={rightPanel}
        direction={isNarrow ? "vertical" : "horizontal"}
        sizes={isNarrow ? NARROW_TOOLS_PANEL_SIZES : TOOLS_PANEL_SIZES}
        className="h-full min-h-0 overflow-hidden"
        mainClassName="h-full min-h-0"
        panelClassName="border-l border-border bg-card"
        main={mainContent}
        panel={<SessionPanel model={rightPanel} toolTabs={toolTabs} />}
      />
    </div>
  );
}

export function WorkspaceSessionReadModelNotice(): ReactElement | null {
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

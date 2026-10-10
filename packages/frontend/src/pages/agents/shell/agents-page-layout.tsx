import type { SessionNavigationRecovery } from "@/features/session-navigation/use-session-navigation-recovery";
import { ChatFileLinkProvider } from "@/components/features/agents/agent-chat/agent-chat-file-link-provider";
import type { ChatFileLinkOwner } from "@/components/features/agents/agent-chat/agent-chat-file-link-context";
import {
  type ComponentProps,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { SessionRepoActions } from "@/components/features/repository-actions/session-repo-actions";
import { WorkflowRail } from "@/components/features/agents/agent-studio-header-workflow-rail";
import { SessionOpenInAction } from "@/components/features/agents/session-open-in-action";
import { SessionViewControls } from "@/components/features/agents/session-view-controls";
import { TaskExecutionSelectedFilePreview } from "@/components/features/agents/task-execution-file-preview";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import {
  BottomPanelSplit,
  type SessionPanelModel,
  SessionPanelSplit,
  type SessionPanelSplitIds,
  type SessionPanelSplitSizes,
  SessionPanelsRoot,
  type SessionPanelsModel,
} from "@/features/session-panels";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentStudioRightPanelBridge } from "./agent-studio-right-panel-bridge";
import {
  AgentsPageModalContent,
  type AgentsPageModalContentModel,
} from "./agents-page-modal-content";
import {
  AgentsPageRightPanelRuntime,
  AgentsPageSelectedFileRefreshRuntime,
} from "./agents-page-right-panel-runtime";
import { AgentsPageShell } from "./agents-page-shell";
import type {
  AgentStudioRightPanelBridgeModel,
  AgentStudioSelectedFileRefreshModel,
} from "./use-agent-studio-right-panel-bridge";

const PANEL_CONTAINMENT_STYLE = {
  contain: "layout paint",
} as const;
const BOTTOM_PANEL_SPLIT_IDS: SessionPanelSplitIds = {
  group: "agent-studio-terminal-layout",
  main: "agent-studio-workspace-panel",
  panel: "agent-studio-terminal-panel",
  separator: "agent-studio-terminal-separator",
};
const RIGHT_PANEL_SPLIT_IDS: SessionPanelSplitIds = {
  group: "agent-studio-right-panel-layout",
  main: "agent-studio-chat-panel",
  panel: "agent-studio-right-panel",
};
const RIGHT_PANEL_SIZES: SessionPanelSplitSizes = {
  main: 63,
  mainMin: "35%",
  panel: 37,
  panelMin: "30%",
};

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  unavailableTaskId: string | null;
  headerContent: ReactNode;
  workflowContent: ReactNode;
  chatContent: ReactElement;
  hasSelectedFilePreview: boolean;
  selectedFilePreviewContent: ReactNode;
  rightPanelContent: ReactNode;
  panels: SessionPanelsModel;
};

export type AgentsPageWorkspacePanesProps = Omit<
  AgentsPageWorkspaceProps,
  "hasSelectedTask" | "unavailableTaskId" | "panels" | "headerContent"
> & { rightPanel: Pick<SessionPanelModel, "presence" | "onSettled" | "onCollapsed"> };

type AgentChatPaneProps = {
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
};

export function AgentsPageWorkspacePanes({
  workflowContent,
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  rightPanelContent,
  rightPanel,
}: AgentsPageWorkspacePanesProps): ReactElement {
  return (
    <SessionPanelSplit
      ids={RIGHT_PANEL_SPLIT_IDS}
      model={rightPanel}
      direction="horizontal"
      sizes={RIGHT_PANEL_SIZES}
      className="h-full min-h-0 overflow-hidden"
      mainClassName="flex h-full min-h-0 flex-col overflow-hidden"
      main={
        <>
          {workflowContent}
          <div
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
            style={PANEL_CONTAINMENT_STYLE}
          >
            {hasSelectedFilePreview ? (
              <div
                className="absolute inset-0 h-full min-h-0 overflow-hidden"
                data-testid="task-execution-selected-file-preview-pane"
              >
                {selectedFilePreviewContent}
              </div>
            ) : null}
            <div
              className="min-h-0 flex-1 overflow-hidden"
              style={{ visibility: hasSelectedFilePreview ? "hidden" : undefined }}
              inert={hasSelectedFilePreview}
              data-testid="agent-studio-chat-pane"
            >
              {chatContent}
            </div>
          </div>
        </>
      }
      panel={rightPanelContent}
    />
  );
}

export function AgentsPageWorkspace({
  hasSelectedTask,
  unavailableTaskId,
  headerContent,
  workflowContent,
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  rightPanelContent,
  panels,
}: AgentsPageWorkspaceProps): ReactElement {
  if (unavailableTaskId) {
    return (
      <section
        role="alert"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-card p-6 text-center"
      >
        <h2 className="text-lg font-semibold">This task is unavailable</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Task {unavailableTaskId} is no longer in this workspace. Select another session in the
          sidebar.
        </p>
      </section>
    );
  }
  if (!hasSelectedTask) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-input bg-card text-sm text-muted-foreground">
        Select a task session in the sidebar.
      </div>
    );
  }

  const workspacePanes = (
    <AgentsPageWorkspacePanes
      workflowContent={workflowContent}
      chatContent={chatContent}
      hasSelectedFilePreview={hasSelectedFilePreview}
      selectedFilePreviewContent={selectedFilePreviewContent}
      rightPanelContent={rightPanelContent}
      rightPanel={panels.right}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {headerContent}
      <SessionPanelsRoot panels={panels}>
        <BottomPanelSplit
          ids={BOTTOM_PANEL_SPLIT_IDS}
          model={panels.bottom}
          className="min-h-0 flex-1 overflow-hidden"
          mainClassName="h-full min-h-0"
        >
          {workspacePanes}
        </BottomPanelSplit>
      </SessionPanelsRoot>
    </div>
  );
}

const MemoizedAgentChatPane = memo(function AgentChatPane({
  chatModel,
}: AgentChatPaneProps): ReactElement {
  return <AgentChatSurface model={chatModel} />;
});

export type AgentsPageLayoutModel = {
  chatFileLinkOwner: ChatFileLinkOwner;
  activeWorkspace: ActiveWorkspace | null;
  navigationPersistenceError: Error | null;
  navigationPersistenceOperation: SessionNavigationRecovery["navigationPersistenceOperation"];
  isRetryingNavigationPersistence?: boolean;
  chatSettingsLoadError: Error | null;
  gitProviderContextLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onRetryGitProviderContext: () => void;
  hasSelectedTask: boolean;
  unavailableTaskId: string | null;
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
  taskExecutionSelectedFilePreviewModel: ComponentProps<
    typeof TaskExecutionSelectedFilePreview
  >["model"];
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
  modalContent: AgentsPageModalContentModel;
  panels: SessionPanelsModel;
};

type AgentsPageLayoutProps = {
  model: AgentsPageLayoutModel;
};

export function AgentsPageLayout({ model }: AgentsPageLayoutProps): ReactElement {
  const {
    chatFileLinkOwner,
    activeWorkspace,
    navigationPersistenceError,
    navigationPersistenceOperation,
    isRetryingNavigationPersistence,
    chatSettingsLoadError,
    gitProviderContextLoadError,
    onRetryNavigationPersistence,
    onRetryChatSettingsLoad,
    onRetryGitProviderContext,
    hasSelectedTask,
    unavailableTaskId,
    chatHeaderModel,
    chatModel,
    taskExecutionSelectedFilePreviewModel,
    rightPanelBridge,
    selectedFileRefresh,
    modalContent,
    panels,
  } = model;
  const linkRef = useRef<HTMLElement | null>(null);
  const hasSelectedFilePreview = taskExecutionSelectedFilePreviewModel.selectedFile !== null;
  useLayoutEffect(() => {
    linkRef.current = null;
  }, [chatFileLinkOwner.repoPath, chatFileLinkOwner.taskId, chatFileLinkOwner.ownerKey]);
  useLayoutEffect(() => {
    if (!hasSelectedFilePreview && linkRef.current?.isConnected) {
      linkRef.current.focus({ preventScroll: true });
      linkRef.current = null;
    }
  }, [hasSelectedFilePreview]);
  const fileLinkOwner = useMemo<ChatFileLinkOwner>(
    () => ({
      ...chatFileLinkOwner,
      onSelectFile: (file, trigger) => {
        linkRef.current = trigger;
        chatFileLinkOwner.onSelectFile(file, trigger);
      },
    }),
    [chatFileLinkOwner],
  );
  const refreshWorktreeRef = useRef<GitDiffRefresh | null>(null);
  const refreshWorktreeAfterFileSave = useCallback((): void => {
    void refreshWorktreeRef.current?.("soft");
  }, []);

  const buildToolsSnapshot = rightPanelBridge?.rightPanel.buildTools.buildToolsSnapshot;
  const openInContextMode = buildToolsSnapshot?.gitPanelContextMode ?? "worktree";
  const openInTargetPath = buildToolsSnapshot?.openInTarget.path ?? null;
  const openInDisabledReason = buildToolsSnapshot
    ? buildToolsSnapshot.openInTarget.disabledReason
    : "The task working directory is unavailable.";
  const headerContent = useMemo(
    () => (
      <AgentStudioHeader
        model={chatHeaderModel}
        repoActions={
          activeWorkspace ? (
            <SessionRepoActions
              workspace={activeWorkspace}
              terminal={{
                startBlockedReason: panels.startBlockedReason,
                onRunAction: panels.runAction,
              }}
            />
          ) : null
        }
        openIn={
          <SessionOpenInAction
            contextMode={openInContextMode}
            targetPath={openInTargetPath}
            disabledReason={openInDisabledReason}
          />
        }
        viewControls={
          <SessionViewControls bottom={panels.bottomToggle} right={panels.rightToggle} />
        }
      />
    ),
    [
      activeWorkspace,
      chatHeaderModel,
      openInContextMode,
      openInTargetPath,
      openInDisabledReason,
      panels.bottomToggle,
      panels.rightToggle,
      panels.runAction,
      panels.startBlockedReason,
    ],
  );
  const workflowContent = useMemo(
    () => (
      <div className="@container/workflow min-w-0 shrink-0 overflow-x-auto border-b border-border bg-card px-4 py-2">
        <WorkflowRail
          steps={chatHeaderModel.workflowSteps}
          selectedRole={chatHeaderModel.selectedRole}
          agentStudioReady={chatHeaderModel.agentStudioReady}
          onStepSelect={chatHeaderModel.onWorkflowStepSelect}
        />
      </div>
    ),
    [
      chatHeaderModel.workflowSteps,
      chatHeaderModel.selectedRole,
      chatHeaderModel.agentStudioReady,
      chatHeaderModel.onWorkflowStepSelect,
    ],
  );
  const chatContent = useMemo(
    () => (
      <ChatFileLinkProvider owner={fileLinkOwner}>
        <MemoizedAgentChatPane chatModel={chatModel} />
      </ChatFileLinkProvider>
    ),
    [chatModel, fileLinkOwner],
  );
  const rightPanelContent = useMemo(
    () => (
      <AgentStudioRightPanelBridge
        model={rightPanelBridge}
        refreshWorktreeRef={refreshWorktreeRef}
      />
    ),
    [rightPanelBridge],
  );
  const selectedFilePreviewContent = useMemo(
    () => (
      <TaskExecutionSelectedFilePreview
        key={taskExecutionSelectedFilePreviewModel.previewSessionKey}
        model={taskExecutionSelectedFilePreviewModel}
        onFileSaved={refreshWorktreeAfterFileSave}
      />
    ),
    [refreshWorktreeAfterFileSave, taskExecutionSelectedFilePreviewModel],
  );
  const workspaceContent = useMemo(
    () => (
      <AgentsPageWorkspace
        hasSelectedTask={hasSelectedTask}
        unavailableTaskId={unavailableTaskId}
        headerContent={headerContent}
        workflowContent={workflowContent}
        chatContent={chatContent}
        hasSelectedFilePreview={hasSelectedFilePreview}
        selectedFilePreviewContent={selectedFilePreviewContent}
        rightPanelContent={rightPanelContent}
        panels={panels}
      />
    ),
    [
      chatContent,
      hasSelectedFilePreview,
      hasSelectedTask,
      unavailableTaskId,
      headerContent,
      workflowContent,
      rightPanelContent,
      selectedFilePreviewContent,
      panels,
    ],
  );
  const modalContentElement = useMemo(
    () => <AgentsPageModalContent model={modalContent} />,
    [modalContent],
  );

  return (
    <>
      {!panels.right.isVisible && rightPanelBridge ? (
        <AgentsPageRightPanelRuntime
          {...rightPanelBridge.rightPanel}
          refreshWorktreeRef={refreshWorktreeRef}
          renderPanel={false}
        />
      ) : null}
      {selectedFileRefresh ? (
        <AgentsPageSelectedFileRefreshRuntime {...selectedFileRefresh} />
      ) : null}
      <AgentsPageShell
        activeWorkspace={activeWorkspace}
        navigationPersistenceError={navigationPersistenceError}
        navigationPersistenceOperation={navigationPersistenceOperation}
        isRetryingNavigationPersistence={isRetryingNavigationPersistence ?? false}
        chatSettingsLoadError={chatSettingsLoadError}
        gitProviderContextLoadError={gitProviderContextLoadError}
        onRetryNavigationPersistence={onRetryNavigationPersistence}
        onRetryChatSettingsLoad={onRetryChatSettingsLoad}
        onRetryGitProviderContext={onRetryGitProviderContext}
        workspace={workspaceContent}
        modalContent={modalContentElement}
      />
    </>
  );
}

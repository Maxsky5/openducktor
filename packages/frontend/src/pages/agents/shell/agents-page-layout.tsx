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
import { SessionViewControls } from "@/components/features/agents/session-view-controls";
import type { TaskExecutionPanelToggleModel } from "@/components/features/agents/task-execution-panel";
import { TaskExecutionSelectedFilePreview } from "@/components/features/agents/task-execution-file-preview";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import {
  TerminalSplitLayout,
  type TerminalSplitIds,
  useTerminalSplit,
} from "@/features/terminals/terminal-split-layout";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioTerminalPanelModel } from "../terminals/use-agent-studio-terminals";
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
const TERMINAL_SPLIT_IDS: TerminalSplitIds = {
  group: "agent-studio-terminal-layout",
  content: "agent-studio-workspace-panel",
  terminal: "agent-studio-terminal-panel",
  separator: "agent-studio-terminal-separator",
};

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  unavailableTaskId: string | null;
  headerContent: ReactNode;
  chatContent: ReactElement;
  hasSelectedFilePreview: boolean;
  selectedFilePreviewContent: ReactNode;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
  terminalPanel: AgentStudioTerminalPanelModel;
};

export type AgentsPageWorkspacePanesProps = Omit<
  AgentsPageWorkspaceProps,
  "hasSelectedTask" | "unavailableTaskId" | "terminalPanel"
>;

type AgentChatPaneProps = {
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
};

export function AgentsPageWorkspacePanes({
  headerContent,
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  isRightPanelVisible,
  rightPanelContent,
}: AgentsPageWorkspacePanesProps): ReactElement {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
      <ResizablePanel defaultSize={63} minSize={35}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {headerContent}
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
        </div>
      </ResizablePanel>
      {isRightPanelVisible ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={37} minSize={30}>
            <div className="h-full min-h-0 overflow-hidden" style={PANEL_CONTAINMENT_STYLE}>
              {rightPanelContent}
            </div>
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

export function AgentsPageWorkspace({
  hasSelectedTask,
  unavailableTaskId,
  headerContent,
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  isRightPanelVisible,
  rightPanelContent,
  terminalPanel,
}: AgentsPageWorkspaceProps): ReactElement {
  const layout = useTerminalSplit(TERMINAL_SPLIT_IDS, terminalPanel.isVisible);
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
      headerContent={headerContent}
      chatContent={chatContent}
      hasSelectedFilePreview={hasSelectedFilePreview}
      selectedFilePreviewContent={selectedFilePreviewContent}
      isRightPanelVisible={isRightPanelVisible}
      rightPanelContent={rightPanelContent}
    />
  );
  return (
    <TerminalSplitLayout
      ids={TERMINAL_SPLIT_IDS}
      model={terminalPanel}
      layout={layout}
      className="h-full min-h-0 overflow-hidden"
      contentClassName="h-full min-h-0"
    >
      {workspacePanes}
    </TerminalSplitLayout>
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
  chatSettingsLoadError: Error | null;
  gitProviderContextLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onRetryGitProviderContext: () => void;
  rightPanelToggleModel: TaskExecutionPanelToggleModel | null;
  hasSelectedTask: boolean;
  unavailableTaskId: string | null;
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
  taskExecutionSelectedFilePreviewModel: ComponentProps<
    typeof TaskExecutionSelectedFilePreview
  >["model"];
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
  modalContent: AgentsPageModalContentModel;
  terminalPanel: AgentStudioTerminalPanelModel;
};

type AgentsPageLayoutProps = {
  model: AgentsPageLayoutModel;
};

export function AgentsPageLayout({ model }: AgentsPageLayoutProps): ReactElement {
  const {
    chatFileLinkOwner,
    activeWorkspace,
    navigationPersistenceError,
    chatSettingsLoadError,
    gitProviderContextLoadError,
    onRetryNavigationPersistence,
    onRetryChatSettingsLoad,
    onRetryGitProviderContext,
    rightPanelToggleModel,
    hasSelectedTask,
    unavailableTaskId,
    chatHeaderModel,
    chatModel,
    taskExecutionSelectedFilePreviewModel,
    isRightPanelVisible,
    rightPanelBridge,
    selectedFileRefresh,
    modalContent,
    terminalPanel,
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

  const headerContent = useMemo(
    () => (
      <AgentStudioHeader
        model={chatHeaderModel}
        viewControls={
          <SessionViewControls
            terminal={terminalPanel}
            tools={
              rightPanelToggleModel ? { ...rightPanelToggleModel, label: "task execution" } : null
            }
          />
        }
      />
    ),
    [chatHeaderModel, rightPanelToggleModel, terminalPanel],
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
        chatContent={chatContent}
        hasSelectedFilePreview={hasSelectedFilePreview}
        selectedFilePreviewContent={selectedFilePreviewContent}
        isRightPanelVisible={isRightPanelVisible}
        rightPanelContent={rightPanelContent}
        terminalPanel={terminalPanel}
      />
    ),
    [
      chatContent,
      hasSelectedFilePreview,
      hasSelectedTask,
      unavailableTaskId,
      headerContent,
      isRightPanelVisible,
      rightPanelContent,
      selectedFilePreviewContent,
      terminalPanel,
    ],
  );
  const modalContentElement = useMemo(
    () => <AgentsPageModalContent model={modalContent} />,
    [modalContent],
  );

  return (
    <>
      {!isRightPanelVisible && rightPanelBridge ? (
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

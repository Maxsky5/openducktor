import { type ComponentProps, memo, type ReactElement, type ReactNode, useMemo } from "react";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import { TaskExecutionSelectedFilePreview } from "@/components/features/agents/task-execution-file-preview";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentStudioRightPanelBridge } from "./agent-studio-right-panel-bridge";
import {
  AgentsPageModalContent,
  type AgentsPageModalContentModel,
} from "./agents-page-modal-content";
import { AgentsPageSelectedFileRefreshRuntime } from "./agents-page-right-panel-runtime";
import { AgentsPageShell } from "./agents-page-shell";
import type {
  AgentStudioRightPanelBridgeModel,
  AgentStudioSelectedFileRefreshModel,
} from "./use-agent-studio-right-panel-bridge";

const PANEL_CONTAINMENT_STYLE = {
  contain: "layout paint",
} as const;

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  chatContent: ReactElement;
  hasSelectedFilePreview: boolean;
  selectedFilePreviewContent: ReactNode;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
};

export type AgentsPageWorkspacePanesProps = Omit<AgentsPageWorkspaceProps, "hasSelectedTask">;

type AgentChatPaneProps = {
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
};

export function AgentsPageWorkspacePanes({
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  isRightPanelVisible,
  rightPanelContent,
}: AgentsPageWorkspacePanesProps): ReactElement {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
      <ResizablePanel defaultSize={63} minSize={35}>
        <div
          className="flex h-full min-h-0 flex-col overflow-hidden"
          style={PANEL_CONTAINMENT_STYLE}
        >
          {hasSelectedFilePreview ? (
            <div
              className="h-full min-h-0 overflow-hidden"
              data-testid="task-execution-selected-file-preview-pane"
            >
              {selectedFilePreviewContent}
            </div>
          ) : null}
          <div
            className="min-h-0 flex-1 overflow-hidden"
            hidden={hasSelectedFilePreview}
            data-testid="agent-studio-chat-pane"
          >
            {chatContent}
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

function AgentsPageWorkspace({
  hasSelectedTask,
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  isRightPanelVisible,
  rightPanelContent,
}: AgentsPageWorkspaceProps): ReactElement {
  if (!hasSelectedTask) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-input bg-card text-sm text-muted-foreground">
        Open a task tab to start a workspace.
      </div>
    );
  }

  return (
    <DiffWorkerProvider>
      <AgentsPageWorkspacePanes
        chatContent={chatContent}
        hasSelectedFilePreview={hasSelectedFilePreview}
        selectedFilePreviewContent={selectedFilePreviewContent}
        isRightPanelVisible={isRightPanelVisible}
        rightPanelContent={rightPanelContent}
      />
    </DiffWorkerProvider>
  );
}

const MemoizedAgentChatPane = memo(function AgentChatPane({
  chatHeaderModel,
  chatModel,
}: AgentChatPaneProps): ReactElement {
  return (
    <AgentChatSurface header={<AgentStudioHeader model={chatHeaderModel} />} model={chatModel} />
  );
});

export type AgentsPageLayoutModel = {
  activeWorkspace: ActiveWorkspace | null;
  navigationPersistenceError: Error | null;
  chatSettingsLoadError: Error | null;
  activeTabValue: string;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onTabValueChange: (value: string) => void;
  taskTabsModel: ComponentProps<typeof AgentStudioTaskTabs>["model"];
  rightPanelToggleModel: ComponentProps<typeof AgentStudioTaskTabs>["rightPanelToggleModel"];
  hasSelectedTask: boolean;
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
  taskExecutionSelectedFilePreviewModel: ComponentProps<
    typeof TaskExecutionSelectedFilePreview
  >["model"];
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
  modalContent: AgentsPageModalContentModel;
};

type AgentsPageLayoutProps = {
  model: AgentsPageLayoutModel;
};

export function AgentsPageLayout({ model }: AgentsPageLayoutProps): ReactElement {
  const {
    activeWorkspace,
    navigationPersistenceError,
    chatSettingsLoadError,
    activeTabValue,
    onRetryNavigationPersistence,
    onRetryChatSettingsLoad,
    onTabValueChange,
    taskTabsModel,
    rightPanelToggleModel,
    hasSelectedTask,
    chatHeaderModel,
    chatModel,
    taskExecutionSelectedFilePreviewModel,
    isRightPanelVisible,
    rightPanelBridge,
    selectedFileRefresh,
    modalContent,
  } = model;

  const taskTabsContent = useMemo(
    () => (
      <AgentStudioTaskTabs
        model={taskTabsModel}
        {...(rightPanelToggleModel !== undefined ? { rightPanelToggleModel } : {})}
      />
    ),
    [rightPanelToggleModel, taskTabsModel],
  );
  const chatContent = useMemo(
    () => <MemoizedAgentChatPane chatHeaderModel={chatHeaderModel} chatModel={chatModel} />,
    [chatHeaderModel, chatModel],
  );
  const rightPanelContent = useMemo(
    () => <AgentStudioRightPanelBridge model={rightPanelBridge} />,
    [rightPanelBridge],
  );
  const selectedFilePreviewContent = useMemo(
    () => (
      <TaskExecutionSelectedFilePreview
        key={taskExecutionSelectedFilePreviewModel.previewSessionKey}
        model={taskExecutionSelectedFilePreviewModel}
      />
    ),
    [taskExecutionSelectedFilePreviewModel],
  );
  const hasSelectedFilePreview = taskExecutionSelectedFilePreviewModel.selectedFile !== null;
  const workspaceContent = useMemo(
    () => (
      <AgentsPageWorkspace
        hasSelectedTask={hasSelectedTask}
        chatContent={chatContent}
        hasSelectedFilePreview={hasSelectedFilePreview}
        selectedFilePreviewContent={selectedFilePreviewContent}
        isRightPanelVisible={isRightPanelVisible}
        rightPanelContent={rightPanelContent}
      />
    ),
    [
      chatContent,
      hasSelectedFilePreview,
      hasSelectedTask,
      isRightPanelVisible,
      rightPanelContent,
      selectedFilePreviewContent,
    ],
  );
  const modalContentElement = useMemo(
    () => <AgentsPageModalContent model={modalContent} />,
    [modalContent],
  );

  return (
    <>
      {selectedFileRefresh ? (
        <AgentsPageSelectedFileRefreshRuntime {...selectedFileRefresh} />
      ) : null}
      <AgentsPageShell
        activeWorkspace={activeWorkspace}
        navigationPersistenceError={navigationPersistenceError}
        chatSettingsLoadError={chatSettingsLoadError}
        activeTabValue={activeTabValue}
        onRetryNavigationPersistence={onRetryNavigationPersistence}
        onRetryChatSettingsLoad={onRetryChatSettingsLoad}
        onTabValueChange={onTabValueChange}
        taskTabs={taskTabsContent}
        workspace={workspaceContent}
        modalContent={modalContentElement}
      />
    </>
  );
}

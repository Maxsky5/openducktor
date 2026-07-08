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
import { AgentsPageShell } from "./agents-page-shell";
import type { AgentStudioRightPanelBridgeModel } from "./use-agent-studio-right-panel-bridge";

const PANEL_CONTAINMENT_STYLE = {
  contain: "layout paint",
} as const;

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  chatContent: ReactElement;
  selectedFilePreviewContent: ReactNode;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
};

type AgentChatPaneProps = {
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
};

function AgentsPageWorkspace({
  hasSelectedTask,
  chatContent,
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
      <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
        <ResizablePanel defaultSize={63} minSize={35}>
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden"
            style={PANEL_CONTAINMENT_STYLE}
          >
            {selectedFilePreviewContent}
            <div className="min-h-0 flex-1 overflow-hidden">{chatContent}</div>
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
    () => <TaskExecutionSelectedFilePreview model={taskExecutionSelectedFilePreviewModel} />,
    [taskExecutionSelectedFilePreviewModel],
  );
  const workspaceContent = useMemo(
    () => (
      <AgentsPageWorkspace
        hasSelectedTask={hasSelectedTask}
        chatContent={chatContent}
        selectedFilePreviewContent={selectedFilePreviewContent}
        isRightPanelVisible={isRightPanelVisible}
        rightPanelContent={rightPanelContent}
      />
    ),
    [
      chatContent,
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
  );
}

import {
  type ComponentProps,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import { AgentStudioTerminalPanel } from "@/components/features/agents/interactive-terminal/agent-studio-terminal-panel";
import { TaskExecutionSelectedFilePreview } from "@/components/features/agents/task-execution-file-preview";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioTerminalPanelModel } from "../terminals/use-agent-studio-terminals";
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
const TERMINAL_GROUP_ID = "agent-studio-terminal-layout";
const WORKSPACE_PANEL_ID = "agent-studio-workspace-panel";
const TERMINAL_PANEL_ID = "agent-studio-terminal-panel";
const TERMINAL_SEPARATOR_ID = "agent-studio-terminal-separator";
const TERMINAL_HIDDEN_LAYOUT = {
  [WORKSPACE_PANEL_ID]: 100,
  [TERMINAL_PANEL_ID]: 0,
};
const TERMINAL_VISIBLE_LAYOUT = {
  [WORKSPACE_PANEL_ID]: 72,
  [TERMINAL_PANEL_ID]: 28,
};

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  chatContent: ReactElement;
  hasSelectedFilePreview: boolean;
  selectedFilePreviewContent: ReactNode;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
  terminalPanel: AgentStudioTerminalPanelModel;
};

export type AgentsPageWorkspacePanesProps = Omit<
  AgentsPageWorkspaceProps,
  "hasSelectedTask" | "terminalPanel"
>;

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

export function AgentsPageWorkspace({
  hasSelectedTask,
  chatContent,
  hasSelectedFilePreview,
  selectedFilePreviewContent,
  isRightPanelVisible,
  rightPanelContent,
  terminalPanel,
}: AgentsPageWorkspaceProps): ReactElement {
  const [isNarrow, setIsNarrow] = useState(false);
  const terminalGroupRef = useRef<GroupImperativeHandle | null>(null);
  const terminalPanelSizeRef = useRef(TERMINAL_VISIBLE_LAYOUT[TERMINAL_PANEL_ID]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useLayoutEffect(() => {
    if (isNarrow) return;
    const group = terminalGroupRef.current;
    if (!group) return;
    const terminalSize = terminalPanel.isVisible ? terminalPanelSizeRef.current : 0;
    group.setLayout({
      [WORKSPACE_PANEL_ID]: 100 - terminalSize,
      [TERMINAL_PANEL_ID]: terminalSize,
    });
  }, [isNarrow, terminalPanel.isVisible]);
  const handleTerminalLayoutChanged = useCallback((layout: Record<string, number>): void => {
    const terminalSize = layout[TERMINAL_PANEL_ID];
    if (terminalSize !== undefined && terminalSize > 0) terminalPanelSizeRef.current = terminalSize;
  }, []);
  if (!hasSelectedTask) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-input bg-card text-sm text-muted-foreground">
        Open a task tab to start a workspace.
      </div>
    );
  }

  const workspacePanes = (
    <AgentsPageWorkspacePanes
      chatContent={chatContent}
      hasSelectedFilePreview={hasSelectedFilePreview}
      selectedFilePreviewContent={selectedFilePreviewContent}
      isRightPanelVisible={isRightPanelVisible}
      rightPanelContent={rightPanelContent}
    />
  );
  if (isNarrow) {
    return (
      <DiffWorkerProvider>
        <div className="relative h-full min-h-0 overflow-hidden">
          <div className="h-full min-h-0" hidden={terminalPanel.isVisible}>
            {workspacePanes}
          </div>
          <div className="h-full min-h-0" hidden={!terminalPanel.isVisible}>
            <AgentStudioTerminalPanel model={terminalPanel} />
          </div>
        </div>
      </DiffWorkerProvider>
    );
  }
  return (
    <DiffWorkerProvider>
      <ResizablePanelGroup
        id={TERMINAL_GROUP_ID}
        defaultLayout={terminalPanel.isVisible ? TERMINAL_VISIBLE_LAYOUT : TERMINAL_HIDDEN_LAYOUT}
        groupRef={terminalGroupRef}
        onLayoutChanged={handleTerminalLayoutChanged}
        direction="vertical"
        className="h-full min-h-0 overflow-hidden"
      >
        <ResizablePanel id={WORKSPACE_PANEL_ID} defaultSize="72%" minSize="30%">
          {workspacePanes}
        </ResizablePanel>
        {terminalPanel.isVisible ? (
          <ResizableHandle
            id={TERMINAL_SEPARATOR_ID}
            aria-label="Resize terminal panel"
            withHandle
          />
        ) : null}
        <ResizablePanel
          id={TERMINAL_PANEL_ID}
          collapsible
          collapsedSize="0%"
          defaultSize="28%"
          minSize="16%"
          maxSize="70%"
        >
          <div className="h-full min-h-0" hidden={!terminalPanel.isVisible}>
            <AgentStudioTerminalPanel model={terminalPanel} />
          </div>
        </ResizablePanel>
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
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
  modalContent: AgentsPageModalContentModel;
  terminalPanel: AgentStudioTerminalPanelModel;
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
    terminalPanel,
  } = model;

  const terminalPanelToggleModel = useMemo(
    () => ({
      isVisible: terminalPanel.isVisible,
      disabled: !terminalPanel.isAvailable,
      onToggle: terminalPanel.onToggle,
    }),
    [terminalPanel.isAvailable, terminalPanel.isVisible, terminalPanel.onToggle],
  );
  const taskTabsContent = useMemo(
    () => (
      <AgentStudioTaskTabs
        model={taskTabsModel}
        {...(rightPanelToggleModel !== undefined ? { rightPanelToggleModel } : {})}
        terminalPanelToggleModel={terminalPanelToggleModel}
      />
    ),
    [rightPanelToggleModel, taskTabsModel, terminalPanelToggleModel],
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
        terminalPanel={terminalPanel}
      />
    ),
    [
      chatContent,
      hasSelectedFilePreview,
      hasSelectedTask,
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

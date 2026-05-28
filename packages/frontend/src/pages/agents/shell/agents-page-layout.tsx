import { type ComponentProps, memo, type ReactElement, type ReactNode, useMemo } from "react";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import { SessionStartModal } from "@/components/features/agents/session-start-modal";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import { TaskDetailsSheetController } from "@/components/features/task-details/task-details-sheet-controller";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentStudioRightPanelBridge } from "./agent-studio-right-panel-bridge";
import { AgentsPageShell } from "./agents-page-shell";
import type { AgentStudioPullRequestModalModel } from "./use-agent-studio-pull-request-modal-model";
import type { AgentStudioRightPanelBridgeModel } from "./use-agent-studio-right-panel-bridge";
import type { AgentStudioTaskDetailsLauncherModel } from "./use-agent-studio-task-details-launcher";

const PANEL_CONTAINMENT_STYLE = {
  contain: "layout paint",
} as const;

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  chatContent: ReactElement;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
};

function AgentsPageWorkspace({
  hasSelectedTask,
  chatContent,
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
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
      <ResizablePanel defaultSize={63} minSize={35}>
        <div className="h-full min-h-0 overflow-hidden" style={PANEL_CONTAINMENT_STYLE}>
          {chatContent}
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

const MemoizedAgentChatPane = memo(function AgentChatPane({
  chatHeaderModel,
  chatModel,
}: {
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChatSurface>["model"];
}): ReactElement {
  return (
    <AgentChatSurface header={<AgentStudioHeader model={chatHeaderModel} />} model={chatModel} />
  );
});

type AgentsPageModalContentProps = {
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  humanReviewFeedbackModal: ComponentProps<typeof HumanReviewFeedbackModal>["model"];
  sessionStartModal: ComponentProps<typeof SessionStartModal>["model"] | null;
  taskDetailsLauncher: AgentStudioTaskDetailsLauncherModel;
};

function AgentsPageModalContent({
  mergedPullRequestModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsLauncher,
}: AgentsPageModalContentProps): ReactElement {
  return (
    <>
      {mergedPullRequestModal ? (
        <MergedPullRequestConfirmDialog {...mergedPullRequestModal} />
      ) : null}
      <HumanReviewFeedbackModal model={humanReviewFeedbackModal} />
      {sessionStartModal ? <SessionStartModal model={sessionStartModal} /> : null}
      <TaskDetailsSheetController
        ref={taskDetailsLauncher.taskDetailsSheetRef}
        {...taskDetailsLauncher.taskDetailsSheetProps}
      />
    </>
  );
}

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
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  humanReviewFeedbackModal: ComponentProps<typeof HumanReviewFeedbackModal>["model"];
  sessionStartModal: ComponentProps<typeof SessionStartModal>["model"] | null;
  taskDetailsLauncher: AgentStudioTaskDetailsLauncherModel;
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
    isRightPanelVisible,
    rightPanelBridge,
    mergedPullRequestModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsLauncher,
  } = model;

  const taskTabs = useMemo(
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
  const workspace = useMemo(
    () => (
      <AgentsPageWorkspace
        hasSelectedTask={hasSelectedTask}
        chatContent={chatContent}
        isRightPanelVisible={isRightPanelVisible}
        rightPanelContent={rightPanelContent}
      />
    ),
    [chatContent, hasSelectedTask, isRightPanelVisible, rightPanelContent],
  );
  const modalContent = useMemo(
    () => (
      <AgentsPageModalContent
        mergedPullRequestModal={mergedPullRequestModal}
        humanReviewFeedbackModal={humanReviewFeedbackModal}
        sessionStartModal={sessionStartModal}
        taskDetailsLauncher={taskDetailsLauncher}
      />
    ),
    [humanReviewFeedbackModal, mergedPullRequestModal, sessionStartModal, taskDetailsLauncher],
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
      taskTabs={taskTabs}
      workspace={workspace}
      modalContent={modalContent}
    />
  );
}

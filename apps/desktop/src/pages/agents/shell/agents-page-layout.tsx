import { type ComponentProps, memo, type ReactElement, type ReactNode } from "react";
import { AgentChat } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentsPageShell } from "./agents-page-shell";

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
  chatModel: ComponentProps<typeof AgentChat>["model"];
}): ReactElement {
  return <AgentChat header={<AgentStudioHeader model={chatHeaderModel} />} model={chatModel} />;
});

type AgentsPageModalContentProps = {
  mergedPullRequestModal: ReactNode;
  humanReviewFeedbackModal: ReactNode;
  sessionStartModal: ReactNode;
  taskDetailsSheet: ReactElement;
};

function AgentsPageModalContent({
  mergedPullRequestModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsSheet,
}: AgentsPageModalContentProps): ReactElement {
  return (
    <>
      {mergedPullRequestModal}
      {humanReviewFeedbackModal}
      {sessionStartModal}
      {taskDetailsSheet}
    </>
  );
}

type AgentsPageLayoutProps = {
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
  chatModel: ComponentProps<typeof AgentChat>["model"];
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
  mergedPullRequestModal: ReactNode;
  humanReviewFeedbackModal: ReactNode;
  sessionStartModal: ReactNode;
  taskDetailsSheet: ReactElement;
};

export function AgentsPageLayout({
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
  rightPanelContent,
  mergedPullRequestModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsSheet,
}: AgentsPageLayoutProps): ReactElement {
  return (
    <AgentsPageShell
      activeWorkspace={activeWorkspace}
      navigationPersistenceError={navigationPersistenceError}
      chatSettingsLoadError={chatSettingsLoadError}
      activeTabValue={activeTabValue}
      onRetryNavigationPersistence={onRetryNavigationPersistence}
      onRetryChatSettingsLoad={onRetryChatSettingsLoad}
      onTabValueChange={onTabValueChange}
      taskTabs={
        <AgentStudioTaskTabs
          model={taskTabsModel}
          {...(rightPanelToggleModel !== undefined ? { rightPanelToggleModel } : {})}
        />
      }
      workspace={
        <AgentsPageWorkspace
          hasSelectedTask={hasSelectedTask}
          chatContent={
            <MemoizedAgentChatPane chatHeaderModel={chatHeaderModel} chatModel={chatModel} />
          }
          isRightPanelVisible={isRightPanelVisible}
          rightPanelContent={rightPanelContent}
        />
      }
      modalContent={
        <AgentsPageModalContent
          mergedPullRequestModal={mergedPullRequestModal}
          humanReviewFeedbackModal={humanReviewFeedbackModal}
          sessionStartModal={sessionStartModal}
          taskDetailsSheet={taskDetailsSheet}
        />
      }
    />
  );
}

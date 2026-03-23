import type { ComponentProps, ReactElement, ReactNode } from "react";
import { AgentChat } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioRightPanel } from "@/components/features/agents/agent-studio-right-panel";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AgentsPageShell } from "./agents-page-shell";

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
        {chatContent}
      </ResizablePanel>
      {isRightPanelVisible ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={37} minSize={30}>
            {rightPanelContent}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

type AgentsPageModalContentProps = {
  gitConflictResolutionModal: ReactNode;
  mergedPullRequestModal: ReactNode;
  humanReviewFeedbackModal: ReactNode;
  sessionStartModal: ReactNode;
  taskDetailsSheet: ReactElement;
};

function AgentsPageModalContent({
  gitConflictResolutionModal,
  mergedPullRequestModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsSheet,
}: AgentsPageModalContentProps): ReactElement {
  return (
    <>
      {gitConflictResolutionModal}
      {mergedPullRequestModal}
      {humanReviewFeedbackModal}
      {sessionStartModal}
      {taskDetailsSheet}
    </>
  );
}

type AgentsPageLayoutProps = {
  activeRepo: string | null;
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
  rightPanelModel: ComponentProps<typeof AgentStudioRightPanel>["model"] | null;
  gitConflictResolutionModal: ReactNode;
  mergedPullRequestModal: ReactNode;
  humanReviewFeedbackModal: ReactNode;
  sessionStartModal: ReactNode;
  taskDetailsSheet: ReactElement;
};

export function AgentsPageLayout({
  activeRepo,
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
  rightPanelModel,
  gitConflictResolutionModal,
  mergedPullRequestModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsSheet,
}: AgentsPageLayoutProps): ReactElement {
  return (
    <AgentsPageShell
      activeRepo={activeRepo}
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
            <AgentChat header={<AgentStudioHeader model={chatHeaderModel} />} model={chatModel} />
          }
          isRightPanelVisible={isRightPanelVisible}
          rightPanelContent={
            rightPanelModel ? <AgentStudioRightPanel model={rightPanelModel} /> : null
          }
        />
      }
      modalContent={
        <AgentsPageModalContent
          gitConflictResolutionModal={gitConflictResolutionModal}
          mergedPullRequestModal={mergedPullRequestModal}
          humanReviewFeedbackModal={humanReviewFeedbackModal}
          sessionStartModal={sessionStartModal}
          taskDetailsSheet={taskDetailsSheet}
        />
      }
    />
  );
}

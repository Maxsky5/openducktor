import type { ReactElement } from "react";
import { AgentsPageLayout } from "../agents-page-layout";
import { useAgentsPageShellModel } from "./use-agents-page-shell-model";

export function AgentsPage(): ReactElement {
  const shell = useAgentsPageShellModel();

  return (
    <AgentsPageLayout
      activeWorkspace={shell.activeWorkspace}
      navigationPersistenceError={shell.navigationPersistenceError}
      chatSettingsLoadError={shell.chatSettingsLoadError}
      activeTabValue={shell.activeTabValue}
      onRetryNavigationPersistence={shell.onRetryNavigationPersistence}
      onRetryChatSettingsLoad={shell.onRetryChatSettingsLoad}
      onTabValueChange={shell.onTabValueChange}
      taskTabsModel={shell.taskTabsModel}
      rightPanelToggleModel={shell.rightPanelToggleModel}
      hasSelectedTask={shell.hasSelectedTask}
      chatHeaderModel={shell.chatHeaderModel}
      chatModel={shell.chatModel}
      isRightPanelVisible={shell.isRightPanelVisible}
      rightPanelContent={shell.rightPanelContent}
      mergedPullRequestModal={shell.mergedPullRequestModal}
      humanReviewFeedbackModal={shell.humanReviewFeedbackModal}
      sessionStartModal={shell.sessionStartModal}
      taskDetailsSheet={shell.taskDetailsSheet}
    />
  );
}

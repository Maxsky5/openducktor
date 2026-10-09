import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type {
  TaskExecutionFileExplorerPanelModel,
  TaskExecutionPanelModel,
  TaskExecutionPanelTab,
  TaskExecutionPanelTabId,
  TaskExecutionPanelToggleModel,
} from "@/components/features/agents";
import type { AgentStudioGitPanelModel } from "@/components/features/agents/agent-studio-git-panel";
import type { TaskExecutionCiChecksPanelModel } from "@/components/features/agents/task-execution-ci-checks-panel";
import type { TaskExecutionDocumentPanelModel } from "@/components/features/agents/task-execution-document-panel";
import { useRightPanelOpen } from "@/components/features/agents/use-right-panel-open";

type UseAgentStudioRightPanelInput = {
  role: AgentRole;
  hasDocumentPanel: boolean;
  canShowPullRequestReview: boolean;
  hasLinkedPullRequest: boolean;
  pullRequestReviewUnavailableReason: string | null;
  hasTaskContext?: boolean;
};

type UseAgentStudioRightPanelState = {
  activeTabId: TaskExecutionPanelTabId | null;
  tabs: TaskExecutionPanelTab[];
  isPanelOpen: boolean;
  onActiveTabChange: (tabId: TaskExecutionPanelTabId) => void;
  rightPanelToggleModel: TaskExecutionPanelToggleModel | null;
  pullRequestReviewUnavailableReason: string | null;
};

const DEFAULT_ACTIVE_TAB_BY_ROLE = {
  spec: "document",
  planner: "document",
  build: "git",
  qa: "document",
} satisfies Record<AgentRole, TaskExecutionPanelTabId>;

const buildTaskExecutionTabs = ({
  hasDocumentPanel,
  canShowPullRequestReview,
  hasLinkedPullRequest,
}: {
  hasDocumentPanel: boolean;
  canShowPullRequestReview: boolean;
  hasLinkedPullRequest: boolean;
}): TaskExecutionPanelTab[] => {
  const tabs: TaskExecutionPanelTab[] = [];
  if (hasDocumentPanel) {
    tabs.push({ id: "document", label: "Document" });
  }
  tabs.push({ id: "git", label: "Git" });
  tabs.push({ id: "file_explorer", label: "File explorer" });
  if (canShowPullRequestReview && hasLinkedPullRequest) {
    tabs.push({ id: "ci_checks", label: "CI Checks" });
  }
  return tabs;
};

const resolveActiveTab = ({
  role,
  requestedTab,
  tabs,
}: {
  role: AgentRole;
  requestedTab: TaskExecutionPanelTabId;
  tabs: TaskExecutionPanelTab[];
}): TaskExecutionPanelTabId | null => {
  if (tabs.length === 0) {
    return null;
  }
  if (tabs.some((tab) => tab.id === requestedTab)) {
    return requestedTab;
  }
  const roleDefault = DEFAULT_ACTIVE_TAB_BY_ROLE[role];
  const fallbackTab = tabs.find((tab) => tab.id === roleDefault) ?? tabs[0];
  return fallbackTab?.id ?? null;
};

type BuildTaskExecutionPanelModelInput = {
  tabs: TaskExecutionPanelTab[];
  activeTabId: TaskExecutionPanelTabId | null;
  documentModel: TaskExecutionDocumentPanelModel | null;
  diffModel: AgentStudioGitPanelModel;
  fileExplorerModel: TaskExecutionFileExplorerPanelModel;
  ciChecksModel: TaskExecutionCiChecksPanelModel | null;
  onActiveTabChange: (tabId: TaskExecutionPanelTabId) => void;
};

export const buildTaskExecutionPanelModel = ({
  tabs,
  activeTabId,
  documentModel,
  diffModel,
  fileExplorerModel,
  ciChecksModel,
  onActiveTabChange,
}: BuildTaskExecutionPanelModelInput): TaskExecutionPanelModel | null => {
  if (!activeTabId || tabs.length === 0) {
    return null;
  }

  return {
    tabs,
    activeTabId,
    onActiveTabChange,
    documentModel,
    gitModel: diffModel,
    fileExplorerModel,
    ciChecksModel,
  };
};

export function useAgentStudioRightPanel({
  role,
  hasDocumentPanel,
  canShowPullRequestReview,
  hasLinkedPullRequest,
  pullRequestReviewUnavailableReason,
  hasTaskContext = true,
}: UseAgentStudioRightPanelInput): UseAgentStudioRightPanelState {
  const { isOpen, toggle } = useRightPanelOpen();

  const [requestedTabByRole, setRequestedTabByRole] = useState<
    Record<AgentRole, TaskExecutionPanelTabId>
  >(() => ({
    ...DEFAULT_ACTIVE_TAB_BY_ROLE,
  }));
  const tabs = useMemo(
    () =>
      hasTaskContext
        ? buildTaskExecutionTabs({
            hasDocumentPanel,
            canShowPullRequestReview,
            hasLinkedPullRequest,
          })
        : [],
    [canShowPullRequestReview, hasDocumentPanel, hasLinkedPullRequest, hasTaskContext],
  );
  const activeTabId = resolveActiveTab({
    role,
    requestedTab: requestedTabByRole[role],
    tabs,
  });
  const isPanelOpen = activeTabId ? isOpen : false;

  const handleActiveTabChange = useCallback(
    (tabId: TaskExecutionPanelTabId) => {
      setRequestedTabByRole((current) => ({
        ...current,
        [role]: tabId,
      }));
    },
    [role],
  );

  const rightPanelToggleModel = useMemo<TaskExecutionPanelToggleModel | null>(() => {
    if (!activeTabId) {
      return null;
    }

    return {
      kind: "task_execution",
      isOpen: isPanelOpen,
      onToggle: toggle,
    };
  }, [activeTabId, isPanelOpen, toggle]);

  return {
    activeTabId,
    tabs,
    isPanelOpen,
    rightPanelToggleModel,
    pullRequestReviewUnavailableReason,
    onActiveTabChange: handleActiveTabChange,
  };
}

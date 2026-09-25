import { FileText, FolderTree, GitBranch, ListChecks } from "lucide-react";
import { memo, type ReactElement } from "react";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import { OpenInMenu } from "./agent-studio-git-panel/open-in-menu";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
import type { AgentStudioDevServerPanelModel } from "./agent-studio-dev-server-panel";
import {
  SharedToolsPanel,
  SharedToolsPanelToggleButton,
  type SharedToolsTab,
} from "./shared-tools-panel";
import {
  TaskExecutionCiChecksPanel,
  type TaskExecutionCiChecksPanelModel,
} from "./task-execution-ci-checks-panel";
import {
  TaskExecutionCiTabIconOverlay,
  useTaskExecutionCiTabIndicator,
} from "./task-execution-ci-tab-indicator";
import { ciTabAriaLabel } from "./task-execution-ci-tab-indicator-model";
import {
  TaskExecutionDocumentPanel,
  type TaskExecutionDocumentPanelModel,
} from "./task-execution-document-panel";
import type { TaskExecutionFileExplorerPanelModel } from "./task-execution-file-explorer-model";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";

export type TaskExecutionPanelTabId = "document" | "git" | "file_explorer" | "ci_checks";
export type TaskExecutionPanelTab = { id: TaskExecutionPanelTabId; label: string };
export type TaskExecutionPanelToggleModel = {
  kind: "task_execution";
  isOpen: boolean;
  onToggle: () => void;
};
export type TaskExecutionPanelModel = {
  tabs: TaskExecutionPanelTab[];
  activeTabId: TaskExecutionPanelTabId;
  onActiveTabChange: (tabId: TaskExecutionPanelTabId) => void;
  documentModel: TaskExecutionDocumentPanelModel | null;
  gitModel: AgentStudioGitPanelModel;
  fileExplorerModel: TaskExecutionFileExplorerPanelModel;
  ciChecksModel: TaskExecutionCiChecksPanelModel | null;
  devServerModel: AgentStudioDevServerPanelModel | null;
};

const tabIcons = {
  document: FileText,
  git: GitBranch,
  file_explorer: FolderTree,
  ci_checks: ListChecks,
} satisfies Record<TaskExecutionPanelTabId, typeof FileText>;

export function TaskExecutionPanelToggleButton({
  model,
}: {
  model: TaskExecutionPanelToggleModel;
}): ReactElement {
  return (
    <SharedToolsPanelToggleButton
      label="task execution"
      isOpen={model.isOpen}
      onToggle={model.onToggle}
    />
  );
}

export function TaskExecutionPanel({ model }: { model: TaskExecutionPanelModel }): ReactElement {
  const ciTabIndicator = useTaskExecutionCiTabIndicator(model.ciChecksModel?.queryInput);
  const content = {
    document: model.documentModel ? (
      <TaskExecutionDocumentPanel model={model.documentModel} />
    ) : null,
    git: <AgentStudioGitPanel model={model.gitModel} />,
    file_explorer: <TaskExecutionFileExplorerPanel model={model.fileExplorerModel} />,
    ci_checks: model.ciChecksModel ? (
      <TaskExecutionCiChecksPanel model={model.ciChecksModel} />
    ) : null,
  } satisfies Record<TaskExecutionPanelTabId, ReactElement | null>;
  const tabs: SharedToolsTab<TaskExecutionPanelTabId>[] = model.tabs.map((tab) => {
    const base = { ...tab, icon: tabIcons[tab.id], content: content[tab.id] };
    if (tab.id !== "ci_checks") return base;
    return {
      ...base,
      ariaLabel: ciTabAriaLabel(tab.label, ciTabIndicator),
      indicator: <TaskExecutionCiTabIconOverlay indicator={ciTabIndicator} />,
    };
  });
  const gitModel = model.gitModel;
  return (
    <SharedToolsPanel
      model={{
        tabs,
        activeTabId: model.activeTabId,
        onActiveTabChange: model.onActiveTabChange,
        tabListLabel: "Task execution sections",
        testIdPrefix: "task-execution",
        headerActions: (
          <>
            {gitModel.pullRequest ? (
              <TaskPullRequestLink pullRequest={gitModel.pullRequest} className="shrink-0" />
            ) : null}
            <OpenInMenu
              contextMode={gitModel.contextMode ?? "worktree"}
              targetPath={gitModel.openInTargetPath ?? null}
              disabledReason={gitModel.openInDisabledReason ?? null}
              onOpenInTool={gitModel.openDirectoryInTool}
            />
          </>
        ),
        devServerModel: model.devServerModel,
      }}
    />
  );
}

export const MemoizedTaskExecutionPanel = memo(TaskExecutionPanel);

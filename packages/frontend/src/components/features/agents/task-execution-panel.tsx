import {
  FileText,
  FolderTree,
  GitBranch,
  ListChecks,
  type LucideIcon,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { ReactElement } from "react";
import { Activity, memo, useState } from "react";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AgentStudioDevServerPanel,
  type AgentStudioDevServerPanelModel,
} from "./agent-studio-dev-server-panel";
import { AgentStudioDevServerSettingsAction } from "./agent-studio-dev-server-settings-action";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import { OpenInMenu } from "./agent-studio-git-panel/open-in-menu";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
import { shouldUseExpandedDevServerLayout } from "./agent-studio-right-panel-layout";
import {
  TaskExecutionCiChecksPanel,
  type TaskExecutionCiChecksPanelModel,
} from "./task-execution-ci-checks-panel";
import {
  TaskExecutionCiTabIconOverlay,
  useTaskExecutionCiTabIndicator,
} from "./task-execution-ci-tab-indicator";
import {
  ciTabAriaLabel,
  type TaskExecutionCiTabIndicator,
} from "./task-execution-ci-tab-indicator-model";
import {
  TaskExecutionDocumentPanel,
  type TaskExecutionDocumentPanelModel,
} from "./task-execution-document-panel";
import type { TaskExecutionFileExplorerPanelModel } from "./task-execution-file-explorer-model";
import { TaskExecutionFileExplorerPanel } from "./task-execution-file-explorer-panel";

export type TaskExecutionPanelTabId = "document" | "git" | "file_explorer" | "ci_checks";

export type TaskExecutionPanelTab = {
  id: TaskExecutionPanelTabId;
  label: string;
};

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

const panelLabel = "task execution";

const isTaskExecutionPanelTabId = (value: string): value is TaskExecutionPanelTabId =>
  value === "document" || value === "git" || value === "file_explorer" || value === "ci_checks";

const taskExecutionPanelTabIcons = {
  document: FileText,
  git: GitBranch,
  file_explorer: FolderTree,
  ci_checks: ListChecks,
} satisfies Record<TaskExecutionPanelTabId, LucideIcon>;

function TaskExecutionPanelTabTrigger({
  indicator,
  isActive,
  tab,
  showSeparator,
}: {
  indicator: TaskExecutionCiTabIndicator | null;
  isActive: boolean;
  tab: TaskExecutionPanelTab;
  showSeparator: boolean;
}): ReactElement {
  const Icon = taskExecutionPanelTabIcons[tab.id];

  return (
    <>
      {showSeparator ? (
        <span
          className="h-5 w-px shrink-0 bg-border"
          aria-hidden="true"
          data-testid="task-execution-tab-separator"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <TabsTrigger
            value={tab.id}
            aria-label={tab.id === "ci_checks" ? ciTabAriaLabel(tab.label, indicator) : tab.label}
            className="group size-9 flex-none cursor-pointer rounded-sm border border-transparent bg-transparent p-0 shadow-none hover:bg-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            data-testid={`task-execution-tab-${tab.id}`}
          >
            <span
              className={cn(
                "relative inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground/60 group-hover:bg-muted group-hover:text-foreground/80",
                isActive ? "text-foreground group-hover:text-foreground" : "",
              )}
              data-testid={isActive ? "task-execution-tab-active-icon" : undefined}
            >
              <Icon className="size-5" aria-hidden="true" />
              {tab.id === "ci_checks" ? (
                <TaskExecutionCiTabIconOverlay indicator={indicator} />
              ) : null}
            </span>
            <span className="sr-only">{tab.label}</span>
          </TabsTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{tab.label}</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function TaskExecutionPanelOpenIn({ model }: { model: AgentStudioGitPanelModel }): ReactElement {
  return (
    <OpenInMenu
      contextMode={model.contextMode ?? "worktree"}
      targetPath={model.openInTargetPath ?? null}
      disabledReason={model.openInDisabledReason ?? null}
      onOpenInTool={model.openDirectoryInTool}
    />
  );
}

function TaskExecutionPanelHeaderActions({
  model,
}: {
  model: TaskExecutionPanelModel;
}): ReactElement {
  return (
    <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">
      {model.gitModel.pullRequest ? (
        <TaskPullRequestLink pullRequest={model.gitModel.pullRequest} className="shrink-0" />
      ) : null}
      <TaskExecutionPanelOpenIn model={model.gitModel} />
    </div>
  );
}

function TaskExecutionPanelTabs({ model }: { model: TaskExecutionPanelModel }): ReactElement {
  const ciTabIndicator = useTaskExecutionCiTabIndicator(model.ciChecksModel?.queryInput);
  const ciChecksActivityMode = model.activeTabId === "ci_checks" ? "visible" : "hidden";

  return (
    <TooltipProvider>
      <Tabs
        value={model.activeTabId}
        onValueChange={(value) => {
          if (isTaskExecutionPanelTabId(value)) {
            model.onActiveTabChange(value);
          }
        }}
        className="h-full min-h-0 gap-0 bg-card"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border pr-2 py-1">
          <TabsList
            aria-label="Task execution sections"
            className="h-9 w-fit shrink-0 gap-0 rounded-none bg-transparent p-0"
          >
            {model.tabs.map((tab, index) => (
              <TaskExecutionPanelTabTrigger
                key={tab.id}
                indicator={tab.id === "ci_checks" ? ciTabIndicator : null}
                isActive={tab.id === model.activeTabId}
                tab={tab}
                showSeparator={index > 0}
              />
            ))}
          </TabsList>
          <TaskExecutionPanelHeaderActions model={model} />
        </div>
        {model.documentModel ? (
          <TabsContent value="document" className="min-h-0 overflow-hidden">
            <TaskExecutionDocumentPanel model={model.documentModel} />
          </TabsContent>
        ) : null}
        <TabsContent value="git" className="min-h-0 overflow-hidden">
          <AgentStudioGitPanel model={model.gitModel} />
        </TabsContent>
        <TabsContent value="file_explorer" className="min-h-0 overflow-hidden">
          <TaskExecutionFileExplorerPanel model={model.fileExplorerModel} />
        </TabsContent>
        {model.ciChecksModel ? (
          <TabsContent value="ci_checks" className="min-h-0 overflow-hidden" forceMount>
            <Activity mode={ciChecksActivityMode}>
              <TaskExecutionCiChecksPanel model={model.ciChecksModel} />
            </Activity>
          </TabsContent>
        ) : null}
      </Tabs>
    </TooltipProvider>
  );
}

function TaskExecutionPanelColumn({ model }: { model: TaskExecutionPanelModel }): ReactElement {
  const [devServerSettingsIsOpen, setDevServerSettingsIsOpen] = useState(false);

  if (!model.devServerModel) {
    return <TaskExecutionPanelTabs model={model} />;
  }

  const useExpandedDevServerLayout = shouldUseExpandedDevServerLayout({
    devServerIsExpanded: model.devServerModel.isExpanded,
    devServerSettingsIsOpen,
  });
  const visibleDevServerModel =
    model.devServerModel.isExpanded === useExpandedDevServerLayout
      ? model.devServerModel
      : { ...model.devServerModel, isExpanded: useExpandedDevServerLayout };

  if (!useExpandedDevServerLayout) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <TaskExecutionPanelTabs model={model} />
        </div>
        <AgentStudioDevServerPanel
          model={visibleDevServerModel}
          compactAction={
            <AgentStudioDevServerSettingsAction
              repositoryPath={model.devServerModel.repoPath}
              onOpenChange={setDevServerSettingsIsOpen}
            />
          }
        />
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel defaultSize={60} minSize={30}>
        <TaskExecutionPanelTabs model={model} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={40} minSize={20}>
        <AgentStudioDevServerPanel model={visibleDevServerModel} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function TaskExecutionPanelToggleButton({
  model,
}: {
  model: TaskExecutionPanelToggleModel;
}): ReactElement {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={agentStudioPanelToggleButtonClassName}
      onClick={model.onToggle}
      aria-label={model.isOpen ? `Hide ${panelLabel} panel` : `Show ${panelLabel} panel`}
      title={model.isOpen ? `Hide ${panelLabel} panel` : `Show ${panelLabel} panel`}
    >
      {model.isOpen ? (
        <PanelRightClose className="size-4" />
      ) : (
        <PanelRightOpen className="size-4" />
      )}
    </Button>
  );
}

export const agentStudioPanelToggleButtonClassName =
  "size-10 rounded-md border border-transparent bg-transparent text-studio-chrome-foreground hover:border-studio-chrome-foreground/30 hover:bg-studio-chrome-foreground/10";

export function TaskExecutionPanel({ model }: { model: TaskExecutionPanelModel }): ReactElement {
  return <TaskExecutionPanelColumn model={model} />;
}

export const MemoizedTaskExecutionPanel = memo(TaskExecutionPanel);

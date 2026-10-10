import { useMemo } from "react";
import { PANEL_TAB_KIND_RULES, type ToolTabViews } from "@/features/session-panels";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
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

export type TaskExecutionToolsModel = {
  documentModel: TaskExecutionDocumentPanelModel | null;
  gitModel: AgentStudioGitPanelModel;
  fileExplorerModel: TaskExecutionFileExplorerPanelModel;
  ciChecksModel: TaskExecutionCiChecksPanelModel | null;
};

/** The content of each task tool tab, with the CI Checks status on its tab. */
export function useTaskExecutionToolTabs(model: TaskExecutionToolsModel): ToolTabViews {
  const ciTabIndicator = useTaskExecutionCiTabIndicator(model.ciChecksModel?.queryInput);
  const { documentModel, gitModel, fileExplorerModel, ciChecksModel } = model;
  return useMemo(
    () => ({
      document: {
        content: documentModel ? <TaskExecutionDocumentPanel model={documentModel} /> : null,
      },
      diffs: { content: <AgentStudioGitPanel model={gitModel} /> },
      files: { content: <TaskExecutionFileExplorerPanel model={fileExplorerModel} /> },
      ci_checks: {
        content: ciChecksModel ? <TaskExecutionCiChecksPanel model={ciChecksModel} /> : null,
        ariaLabel: ciTabAriaLabel(PANEL_TAB_KIND_RULES.ci_checks.label, ciTabIndicator),
        indicator: <TaskExecutionCiTabIconOverlay indicator={ciTabIndicator} />,
      },
    }),
    [ciChecksModel, ciTabIndicator, documentModel, fileExplorerModel, gitModel],
  );
}

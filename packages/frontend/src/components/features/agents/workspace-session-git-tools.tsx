import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import { memo, type ReactElement, type ReactNode, useMemo } from "react";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import type { ManualRefresh } from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import type { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";

export function WorkspaceSessionGitTools({
  actions,
  commentOwner,
  control,
  diffData,
  contextMode,
  repositoryBranchControl,
  branchReady,
  resolvedTarget,
  unavailableReason,
  workingDirectory,
  manualRefresh,
  onSelectFile,
}: WorkspaceSessionGitToolsProps): ReactElement {
  // A stable callback keeps the memoized panel from drawing again on each tools update.
  const viewFile = useMemo(
    () =>
      workingDirectory
        ? (relativePath: string) => void onSelectFile({ rootPath: workingDirectory, relativePath })
        : null,
    [onSelectFile, workingDirectory],
  );
  const model: AgentStudioGitPanelModel = {
    ...diffData,
    ...actions,
    subjectKey: JSON.stringify([commentOwner.workspaceId, commentOwner.sessionId]),
    commentOwner,
    commentPlaceholder: "Add a comment for this chat",
    ...control,
    refresh: manualRefresh.refresh,
    isRefreshing: manualRefresh.isRefreshing,
    refreshError: manualRefresh.refreshError,
    isLoading: diffData.isLoading || !branchReady,
    contextMode,
    repositoryBranchControl,
    targetBranch: diffData.targetBranch,
    comparisonUnavailableReason: unavailableReason,
    // The comparison view already hides Branch changes until its comparison is ready.
    comparisonReference: resolvedTarget,
    rebaseOntoTarget: resolvedTarget ? actions.rebaseOntoTarget : undefined,
    openInTargetPath: workingDirectory,
    openInDisabledReason: workingDirectory
      ? null
      : "The selected working directory is unavailable.",
    onViewFile: viewFile,
  };
  return <GitPanel {...model} />;
}

type WorkspaceSessionGitToolsProps = {
  actions: ReturnType<typeof useAgentStudioGitActions>;
  commentOwner: Extract<InlineCommentOwner, { kind: "workspace_session" }>;
  control: ReturnType<
    typeof import("@/features/agent-studio-git/use-session-comparison-control").useSessionComparisonControl
  >;
  diffData: DiffDataState;
  contextMode: "repository" | "worktree";
  repositoryBranchControl?: ReactNode;
  branchReady: boolean;
  resolvedTarget: string | null;
  unavailableReason: string | null;
  workingDirectory: string | null;
  manualRefresh: ManualRefresh;
  /** Opens the file preview, as the Files tab does. */
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
};

// Keep file explorer updates from redrawing unchanged Git data.
const GitPanel = memo(function GitPanel(model: AgentStudioGitPanelModel): ReactElement {
  return <AgentStudioGitPanel model={model} />;
});

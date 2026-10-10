import type { InlineCommentOwner } from "@/types/inline-comment-owner";
import { memo, type ReactElement, type ReactNode } from "react";
import type { DiffDataState } from "@/features/agent-studio-git";
import type { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";

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
  isFetchingTarget,
  refresh,
}: WorkspaceSessionGitToolsProps): ReactElement {
  const model: AgentStudioGitPanelModel = {
    ...diffData,
    ...actions,
    subjectKey: JSON.stringify([commentOwner.workspaceId, commentOwner.sessionId]),
    commentOwner,
    commentPlaceholder: "Add a comment for this chat",
    ...control,
    refresh,
    isLoading: diffData.isLoading || isFetchingTarget || !branchReady,
    contextMode,
    repositoryBranchControl,
    targetBranch: diffData.targetBranch,
    comparisonUnavailableReason: unavailableReason,
    comparisonReference: resolvedTarget,
    diffScope: resolvedTarget ? diffData.diffScope : "uncommitted",
    commitsAheadBehind: resolvedTarget ? diffData.commitsAheadBehind : null,
    scopeStatesByScope: resolvedTarget
      ? diffData.scopeStatesByScope
      : {
          ...diffData.scopeStatesByScope,
          target: {
            ...diffData.scopeStatesByScope.target,
            fileDiffs: [],
            fileStatuses: [],
            commitsAheadBehind: null,
            error: null,
          },
        },
    loadedScopesByScope: {
      ...diffData.loadedScopesByScope,
      target: resolvedTarget !== null && diffData.loadedScopesByScope.target,
    },
    rebaseOntoTarget: resolvedTarget ? actions.rebaseOntoTarget : undefined,
    openInTargetPath: workingDirectory,
    openInDisabledReason: workingDirectory
      ? null
      : "The selected working directory is unavailable.",
  };
  return <GitPanel {...model} />;
}

type WorkspaceSessionGitToolsProps = {
  actions: ReturnType<typeof useAgentStudioGitActions>;
  commentOwner: Extract<InlineCommentOwner, { kind: "workspace_session" }>;
  control: ReturnType<
    typeof import("@/features/agent-studio-git/use-session-comparison").useSessionComparisonControl
  >;
  diffData: DiffDataState;
  contextMode: "repository" | "worktree";
  repositoryBranchControl?: ReactNode;
  branchReady: boolean;
  resolvedTarget: string | null;
  unavailableReason: string | null;
  workingDirectory: string | null;
  isFetchingTarget: boolean;
  refresh: () => Promise<void>;
};

// Keep file explorer updates from redrawing unchanged Git data.
const GitPanel = memo(function GitPanel(model: AgentStudioGitPanelModel): ReactElement {
  return <AgentStudioGitPanel model={model} />;
});

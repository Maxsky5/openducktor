import type { DevServerOwner } from "@openducktor/contracts";
import type { InlineCommentOwner } from "@/types/inline-comment-owner";
import { GitBranch } from "lucide-react";
import { memo, type ReactElement, type ReactNode } from "react";
import { useAgentStudioDevServerPanel } from "@/features/dev-servers/use-agent-studio-dev-server-panel";
import type { DiffDataState } from "@/features/agent-studio-git";
import type { useAgentStudioGitActions } from "@/pages/agents/use-agent-studio-git-actions";
import { AgentStudioGitPanel } from "./agent-studio-git-panel/agent-studio-git-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel/types";
import { useGitCommentDraftValidation } from "./agent-studio-git-panel/use-git-comment-draft-validation";
import { SharedToolsPanel, type SharedToolsPanelModel } from "./shared-tools-panel";
import type { WorkspaceToolsTabId } from "./use-workspace-session-tools";

export function WorkspaceSessionGitTools({
  commentOwner,
  repoPath,
  devServerOwner,
  actions,
  diffData,
  contextMode,
  repositoryBranchControl,
  branchReady,
  resolvedTarget,
  unavailableReason,
  workingDirectory,
  isFetchingTarget,
  refresh,
  tools,
}: WorkspaceSessionGitToolsProps): ReactElement {
  const devServerModel = useAgentStudioDevServerPanel({
    repoPath,
    owner: devServerOwner,
    enabled: true,
  });
  const model: AgentStudioGitPanelModel = {
    ...diffData,
    ...actions,
    subjectKey: JSON.stringify([commentOwner.workspaceId, commentOwner.sessionId]),
    commentOwner,
    commentPlaceholder: "Add a comment for this chat",
    refresh,
    isLoading: diffData.isLoading || isFetchingTarget || !branchReady,
    contextMode,
    repositoryBranchControl,
    targetBranch: resolvedTarget ?? "",
    comparisonUnavailableReason: unavailableReason,
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
    askBuilderToResolveGitConflict: undefined,
    openInTargetPath: workingDirectory,
    openInDisabledReason: workingDirectory
      ? null
      : "The selected working directory is unavailable.",
  };
  useGitCommentDraftValidation(model);
  return (
    <SharedToolsPanel
      model={{
        ...tools,
        devServerModel,
        tabs: [
          { id: "git", label: "Git", icon: GitBranch, content: <GitPanel {...model} /> },
          ...tools.tabs,
        ],
      }}
    />
  );
}

type WorkspaceSessionGitToolsProps = {
  commentOwner: Extract<InlineCommentOwner, { kind: "workspace_session" }>;
  repoPath: string;
  devServerOwner: DevServerOwner;
  tools: SharedToolsPanelModel<WorkspaceToolsTabId>;
  actions: ReturnType<typeof useAgentStudioGitActions>;
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

// Keep dev-server updates from redrawing unchanged Git data.
const GitPanel = memo(function GitPanel(model: AgentStudioGitPanelModel): ReactElement {
  return <AgentStudioGitPanel model={model} />;
});

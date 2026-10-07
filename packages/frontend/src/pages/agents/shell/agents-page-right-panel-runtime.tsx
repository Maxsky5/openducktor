import { useQueryClient } from "@tanstack/react-query";
import { memo, type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { useOptionalAgentSessionTranscriptDialog } from "@/components/features/agents/agent-chat/agent-session-transcript-dialog-context";
import { MemoizedTaskExecutionPanel } from "@/components/features/agents/task-execution-panel";
import { RepositoryBranchSwitcher } from "@/components/features/repository/repository-branch-switcher";
import { useAgentStudioBuildWorktreeRefresh } from "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  type UseAgentsPageRightPanelModelArgs,
  useAgentsPageRightPanelModel,
} from "../use-agents-page-right-panel-model";
import type {
  AgentStudioBuildWorktreeRefreshModel,
  AgentStudioSelectedFileRefreshModel,
} from "./use-agent-studio-right-panel-bridge";
import {
  useForwardedWorktreeRefresh,
  type WorktreeRefreshRef,
} from "./use-forwarded-worktree-refresh";

export const AgentsPageRightPanelRuntime = memo(function AgentsPageRightPanelRuntime({
  refreshWorktreeRef,
  renderPanel = true,
  ...args
}: UseAgentsPageRightPanelModelArgs & {
  refreshWorktreeRef: WorktreeRefreshRef;
  renderPanel?: boolean;
}): ReactElement | null {
  const { rightPanelModel: panelModel, refreshWorktree } = useAgentsPageRightPanelModel(args);
  // The Git panel shows the branch switcher only for the repository root.
  const rightPanelModel = useMemo(
    () =>
      panelModel && {
        ...panelModel,
        gitModel: {
          ...panelModel.gitModel,
          repositoryBranchControl: <RepositoryBranchSwitcher layout="inline" />,
        },
      },
    [panelModel],
  );

  const registerFileSaveHandler =
    useOptionalAgentSessionTranscriptDialog()?.registerFileSaveHandler;
  const repoPath = args.activeWorkspace?.repoPath ?? null;
  const taskId = args.selectedView.taskId;
  const contextMode = rightPanelModel?.gitModel.contextMode;
  useLayoutEffect(
    () =>
      registerFileSaveHandler?.((savedRepoPath, savedTaskId) => {
        if (savedRepoPath === repoPath && savedTaskId === taskId && contextMode === "worktree")
          // File queries render refresh failures independently from the completed save.
          void refreshWorktree("soft").catch(() => {});
      }),
    [registerFileSaveHandler, repoPath, taskId, contextMode, refreshWorktree],
  );

  useEffect(() => {
    refreshWorktreeRef.current = refreshWorktree;
    return () => {
      if (refreshWorktreeRef.current === refreshWorktree) {
        refreshWorktreeRef.current = null;
      }
    };
  }, [refreshWorktree, refreshWorktreeRef]);

  return renderPanel && rightPanelModel ? (
    <MemoizedTaskExecutionPanel model={rightPanelModel} />
  ) : null;
});

export function AgentsPageBuildWorktreeRefreshRuntime({
  isPanelOpen,
  selectedView,
  refreshWorktreeRef,
}: {
  activeTabId: AgentStudioBuildWorktreeRefreshModel["activeTabId"];
  isPanelOpen: boolean;
  selectedView: AgentStudioBuildWorktreeRefreshModel["selectedView"];
  refreshWorktreeRef: WorktreeRefreshRef;
}): null {
  const refreshWorktree = useForwardedWorktreeRefresh(refreshWorktreeRef);

  useAgentStudioBuildWorktreeRefresh({
    selectedView: {
      role: isPanelOpen ? selectedView.role : null,
      loadedSession: selectedView.loadedSession,
    },
    refreshWorktree,
  });

  return null;
}

export function AgentsPageSelectedFileRefreshRuntime({
  selectedFile,
  selectedView,
}: AgentStudioSelectedFileRefreshModel): null {
  const queryClient = useQueryClient();
  const refreshSelectedFile = useCallback<GitDiffRefresh>(async () => {
    await refreshWorkspaceFileQueries(queryClient, selectedFile.rootPath);
  }, [queryClient, selectedFile.rootPath]);

  useAgentStudioBuildWorktreeRefresh({
    selectedView,
    refreshWorktree: refreshSelectedFile,
  });

  return null;
}

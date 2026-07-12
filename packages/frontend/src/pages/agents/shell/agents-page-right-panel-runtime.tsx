import { useQueryClient } from "@tanstack/react-query";
import { memo, type ReactElement, useCallback, useEffect } from "react";
import { MemoizedTaskExecutionPanel } from "@/components/features/agents/task-execution-panel";
import { useAgentStudioBuildWorktreeRefresh } from "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
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
  ...args
}: UseAgentsPageRightPanelModelArgs & {
  refreshWorktreeRef: WorktreeRefreshRef;
}): ReactElement | null {
  const { rightPanelModel, refreshWorktree } = useAgentsPageRightPanelModel(args);

  useEffect(() => {
    refreshWorktreeRef.current = refreshWorktree;
    return () => {
      if (refreshWorktreeRef.current === refreshWorktree) {
        refreshWorktreeRef.current = null;
      }
    };
  }, [refreshWorktree, refreshWorktreeRef]);

  return rightPanelModel ? <MemoizedTaskExecutionPanel model={rightPanelModel} /> : null;
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
    await queryClient.invalidateQueries({
      queryKey: filesystemQueryKeys.textFile(selectedFile.rootPath, selectedFile.relativePath),
    });
  }, [queryClient, selectedFile.relativePath, selectedFile.rootPath]);

  useAgentStudioBuildWorktreeRefresh({
    selectedView,
    refreshWorktree: refreshSelectedFile,
  });

  return null;
}

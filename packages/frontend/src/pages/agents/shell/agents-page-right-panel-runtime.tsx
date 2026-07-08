import { memo, type ReactElement, useEffect } from "react";
import { MemoizedTaskExecutionPanel } from "@/components/features/agents/task-execution-panel";
import { useAgentStudioBuildWorktreeRefresh } from "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh";
import {
  type UseAgentsPageRightPanelModelArgs,
  useAgentsPageRightPanelModel,
} from "../use-agents-page-right-panel-model";
import type { AgentStudioBuildWorktreeRefreshModel } from "./use-agent-studio-right-panel-bridge";
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
  activeTabId,
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
      role: activeTabId === "git" && isPanelOpen ? selectedView.role : null,
      loadedSession: selectedView.loadedSession,
    },
    refreshWorktree,
  });

  return null;
}

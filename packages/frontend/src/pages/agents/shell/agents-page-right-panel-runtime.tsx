import { memo, type ReactElement, useEffect } from "react";
import { MemoizedAgentStudioRightPanel } from "@/components/features/agents/agent-studio-right-panel";
import { useAgentStudioBuildWorktreeRefresh } from "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh";
import type { AgentStudioOrchestrationSelectionContext } from "../use-agent-studio-orchestration-controller";
import {
  type UseAgentsPageRightPanelModelArgs,
  useAgentsPageRightPanelModel,
} from "../use-agents-page-right-panel-model";
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

  return rightPanelModel ? <MemoizedAgentStudioRightPanel model={rightPanelModel} /> : null;
});

export function AgentsPageBuildWorktreeRefreshRuntime({
  panelKind,
  isPanelOpen,
  viewRole,
  activeSession,
  viewSessionLifecycle,
  refreshWorktreeRef,
}: {
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  viewRole: UseAgentsPageRightPanelModelArgs["viewRole"];
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  viewSessionLifecycle: UseAgentsPageRightPanelModelArgs["viewSessionLifecycle"];
  refreshWorktreeRef: WorktreeRefreshRef;
}): null {
  const refreshWorktree = useForwardedWorktreeRefresh(refreshWorktreeRef);

  useAgentStudioBuildWorktreeRefresh({
    viewRole: panelKind === "build_tools" && isPanelOpen ? viewRole : null,
    activeSession,
    isSessionHistoryLoading: viewSessionLifecycle.isLoadingHistory,
    refreshWorktree,
  });

  return null;
}

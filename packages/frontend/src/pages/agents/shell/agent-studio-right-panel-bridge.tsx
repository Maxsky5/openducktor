import type { ReactElement } from "react";
import {
  AgentsPageBuildWorktreeRefreshRuntime,
  AgentsPageRightPanelRuntime,
} from "./agents-page-right-panel-runtime";
import type { AgentStudioRightPanelBridgeModel } from "./use-agent-studio-right-panel-bridge";
import type { WorktreeRefreshRef } from "./use-forwarded-worktree-refresh";

type AgentStudioRightPanelBridgeProps = {
  model: AgentStudioRightPanelBridgeModel | null;
  refreshWorktreeRef: WorktreeRefreshRef;
};

export function AgentStudioRightPanelBridge({
  model,
  refreshWorktreeRef,
}: AgentStudioRightPanelBridgeProps): ReactElement | null {
  if (!model) {
    return null;
  }

  return (
    <>
      <AgentsPageBuildWorktreeRefreshRuntime
        {...model.buildWorktreeRefresh}
        refreshWorktreeRef={refreshWorktreeRef}
      />
      <AgentsPageRightPanelRuntime {...model.rightPanel} refreshWorktreeRef={refreshWorktreeRef} />
    </>
  );
}

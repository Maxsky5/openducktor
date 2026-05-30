import { type ReactElement, useRef } from "react";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import {
  AgentsPageBuildWorktreeRefreshRuntime,
  AgentsPageRightPanelRuntime,
} from "./agents-page-right-panel-runtime";
import type { AgentStudioRightPanelBridgeModel } from "./use-agent-studio-right-panel-bridge";

export function AgentStudioRightPanelBridge({
  model,
}: {
  model: AgentStudioRightPanelBridgeModel | null;
}): ReactElement | null {
  const rightPanelRefreshWorktreeRef = useRef<GitDiffRefresh | null>(null);

  if (!model) {
    return null;
  }

  return (
    <>
      <AgentsPageBuildWorktreeRefreshRuntime
        {...model.buildWorktreeRefresh}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
      <AgentsPageRightPanelRuntime
        {...model.rightPanel}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
    </>
  );
}

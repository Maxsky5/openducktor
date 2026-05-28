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

  const { activeSession, ...rightPanelRuntimeModel } = model;

  return (
    <>
      <AgentsPageBuildWorktreeRefreshRuntime
        panelKind={model.panelKind}
        isPanelOpen={model.isPanelOpen}
        viewRole={model.viewRole}
        activeSession={activeSession}
        isSessionHistoryHydrating={model.isViewSessionHistoryHydrating}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
      <AgentsPageRightPanelRuntime
        {...rightPanelRuntimeModel}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
    </>
  );
}

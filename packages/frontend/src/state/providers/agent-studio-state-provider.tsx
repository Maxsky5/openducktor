import type { AgentEnginePort } from "@openducktor/core";
import { type PropsWithChildren, type ReactElement, useEffect } from "react";
import { WorkspaceActivityContext } from "../workspace-activity/workspace-activity-context";
import {
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  useRequiredContext,
  useTaskControlContext,
  useTaskSnapshotContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useAgentOrchestratorOperations } from "../operations/agent-orchestrator/use-agent-orchestrator-operations";

type AgentStudioStateProviderProps = PropsWithChildren<{
  agentEngine: AgentEnginePort;
}>;

export function AgentStudioStateProvider({
  agentEngine,
  children,
}: AgentStudioStateProviderProps): ReactElement {
  const activityObserver = useRequiredContext(WorkspaceActivityContext, "AgentStudioStateProvider");
  const { activeWorkspace } = useRequiredContext(WorkspaceStateContext, "AgentStudioStateProvider");
  const { tasks, isLoadingTasks } = useTaskSnapshotContext();
  const { refreshTaskData } = useTaskControlContext();
  const { sessionStore, operations, historyLoadActions, readModelState } =
    useAgentOrchestratorOperations({
      activeWorkspace,
      tasks,
      isLoadingTasks,
      refreshTaskData,
      agentEngine,
    });

  useEffect(
    () => activityObserver.subscribeHistoryInvalidations(sessionStore.invalidateRetainedHistory),
    [activityObserver, sessionStore],
  );

  return (
    <AgentOperationsContext.Provider value={operations}>
      <AgentSessionHistoryLoadContext.Provider value={historyLoadActions}>
        <AgentSessionReadModelStateContext.Provider value={readModelState}>
          <AgentSessionsContext.Provider value={sessionStore}>
            {children}
          </AgentSessionsContext.Provider>
        </AgentSessionReadModelStateContext.Provider>
      </AgentSessionHistoryLoadContext.Provider>
    </AgentOperationsContext.Provider>
  );
}

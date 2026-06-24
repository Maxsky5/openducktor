import type { AgentEnginePort } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
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

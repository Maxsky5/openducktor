import type { AgentEnginePort } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import {
  AgentOperationsContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  useRequiredContext,
  useTaskControlContext,
  useTaskDataContext,
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
  const { tasks } = useTaskDataContext();
  const { refreshTaskData } = useTaskControlContext();
  const { sessionStore, operations, readModelState } = useAgentOrchestratorOperations({
    activeWorkspace,
    tasks,
    refreshTaskData,
    agentEngine,
  });

  return (
    <AgentOperationsContext.Provider value={operations}>
      <AgentSessionReadModelStateContext.Provider value={readModelState}>
        <AgentSessionsContext.Provider value={sessionStore}>
          {children}
        </AgentSessionsContext.Provider>
      </AgentSessionReadModelStateContext.Provider>
    </AgentOperationsContext.Provider>
  );
}

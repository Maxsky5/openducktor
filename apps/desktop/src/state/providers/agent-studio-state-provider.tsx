import type { AgentEnginePort } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  useActiveRepoContext,
  useTaskControlContext,
  useTaskDataContext,
} from "../app-state-contexts";
import { useAgentOrchestratorOperations } from "../operations";

type AgentStudioStateProviderProps = PropsWithChildren<{
  agentEngine: AgentEnginePort;
}>;

export function AgentStudioStateProvider({
  agentEngine,
  children,
}: AgentStudioStateProviderProps): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const { tasks, runs } = useTaskDataContext();
  const { refreshTaskData } = useTaskControlContext();
  const { sessionStore, operations } = useAgentOrchestratorOperations({
    activeRepo,
    tasks,
    runs,
    refreshTaskData,
    agentEngine,
  });

  return (
    <AgentOperationsContext.Provider value={operations}>
      <AgentSessionsContext.Provider value={sessionStore}>{children}</AgentSessionsContext.Provider>
    </AgentOperationsContext.Provider>
  );
}

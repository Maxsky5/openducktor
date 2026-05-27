import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { type PropsWithChildren, type ReactElement, useCallback } from "react";
import { isRepoRuntimeReady } from "@/lib/repo-runtime-health";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  ChecksStateContext,
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
  const { runtimeHealthByRuntime } = useRequiredContext(
    ChecksStateContext,
    "AgentStudioStateProvider",
  );
  const { tasks } = useTaskDataContext();
  const { refreshTaskData } = useTaskControlContext();
  const isSessionRuntimeReady = useCallback(
    (runtimeKind: RuntimeKind): boolean =>
      isRepoRuntimeReady(runtimeHealthByRuntime[runtimeKind] ?? null),
    [runtimeHealthByRuntime],
  );
  const { sessionStore, operations } = useAgentOrchestratorOperations({
    activeWorkspace,
    tasks,
    refreshTaskData,
    agentEngine,
    isSessionRuntimeReady,
  });

  return (
    <AgentOperationsContext.Provider value={operations}>
      <AgentSessionsContext.Provider value={sessionStore}>{children}</AgentSessionsContext.Provider>
    </AgentOperationsContext.Provider>
  );
}

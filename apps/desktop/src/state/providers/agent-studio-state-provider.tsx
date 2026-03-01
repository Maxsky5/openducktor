import type { AgentEnginePort } from "@openducktor/core";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildAgentStateValue } from "../app-state-context-values";
import {
  AgentStateContext,
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
  const {
    sessions,
    loadAgentSessions,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentOrchestratorOperations({
    activeRepo,
    tasks,
    runs,
    refreshTaskData,
    agentEngine,
  });

  const agentStateValue = useMemo(
    () =>
      buildAgentStateValue({
        sessions,
        loadAgentSessions,
        startAgentSession,
        sendAgentMessage,
        stopAgentSession,
        updateAgentSessionModel,
        replyAgentPermission,
        answerAgentQuestion,
      }),
    [
      answerAgentQuestion,
      loadAgentSessions,
      replyAgentPermission,
      sendAgentMessage,
      sessions,
      startAgentSession,
      stopAgentSession,
      updateAgentSessionModel,
    ],
  );

  return (
    <AgentStateContext.Provider value={agentStateValue}>{children}</AgentStateContext.Provider>
  );
}

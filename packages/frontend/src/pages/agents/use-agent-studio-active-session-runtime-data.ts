import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import type { AgentSessionViewLifecyclePhase } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";

type UseAgentStudioActiveSessionRuntimeDataArgs = {
  session: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  agentStudioReadinessState: AgentStudioReadinessState;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
};

export type AgentStudioSessionRuntimeDataState = {
  session: AgentSessionState | null;
  runtimeDataError: string | null;
  sessionViewLifecyclePhase: AgentSessionViewLifecyclePhase;
};

export const useAgentStudioActiveSessionRuntimeData = ({
  session,
  runtimeDefinitions,
  agentStudioReadinessState,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentStudioActiveSessionRuntimeDataArgs): AgentStudioSessionRuntimeDataState =>
  useSessionRuntimeData({
    session,
    runtimeDefinitions,
    repoReadinessState: agentStudioReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });

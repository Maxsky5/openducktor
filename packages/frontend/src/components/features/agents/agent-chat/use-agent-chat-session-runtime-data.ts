import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import type {
  AgentSessionViewLifecyclePhase,
  SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentChatSessionRuntimeDataArgs = {
  session: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: SessionRepoReadinessState;
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

export type AgentChatSessionRuntimeDataState = {
  session: AgentSessionState | null;
  runtimeDataError: string | null;
  sessionViewLifecyclePhase: AgentSessionViewLifecyclePhase;
};

export const useAgentChatSessionRuntimeData = ({
  session,
  runtimeDefinitions,
  repoReadinessState,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentChatSessionRuntimeDataArgs): AgentChatSessionRuntimeDataState =>
  useSessionRuntimeData({
    session,
    runtimeDefinitions,
    repoReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });

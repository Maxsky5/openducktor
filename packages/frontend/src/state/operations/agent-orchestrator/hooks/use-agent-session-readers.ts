import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentSessionRef,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { useCallback, useMemo } from "react";

export const useAgentSessionReaders = (agentEngine: AgentEnginePort) => {
  const readSessionModelCatalog = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      agentEngine.listAvailableModels({ repoPath, runtimeKind }),
    [agentEngine],
  );
  const readSessionTodos = useCallback(
    (session: AgentSessionRef) => agentEngine.loadSessionTodos(session),
    [agentEngine],
  );
  const readSessionHistory = useCallback(
    (session: LoadAgentSessionHistoryInput) => agentEngine.loadSessionHistory(session),
    [agentEngine],
  );
  const readSessionSlashCommands = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      agentEngine.listAvailableSlashCommands({ repoPath, runtimeKind }),
    [agentEngine],
  );
  const readSessionSkills = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string) =>
      agentEngine.listAvailableSkills({ repoPath, runtimeKind, workingDirectory }),
    [agentEngine],
  );
  const readSessionFileSearch = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string, query: string) =>
      agentEngine.searchFiles({ repoPath, runtimeKind, workingDirectory, query }),
    [agentEngine],
  );
  return useMemo(
    () => ({
      readSessionModelCatalog,
      readSessionTodos,
      readSessionHistory,
      readSessionSlashCommands,
      readSessionSkills,
      readSessionFileSearch,
    }),
    [
      readSessionFileSearch,
      readSessionHistory,
      readSessionModelCatalog,
      readSessionSlashCommands,
      readSessionSkills,
      readSessionTodos,
    ],
  );
};

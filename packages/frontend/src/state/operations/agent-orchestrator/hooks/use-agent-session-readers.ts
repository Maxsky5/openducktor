import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo } from "react";

export const useAgentSessionReaders = (agentEngine: AgentEnginePort) => {
  const readSessionModelCatalog = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      agentEngine.listAvailableModels({ repoPath, runtimeKind }),
    [agentEngine],
  );
  const readSessionTodos = useCallback(
    (
      repoPath: string,
      runtimeKind: RuntimeKind,
      workingDirectory: string,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionTodos({ repoPath, runtimeKind, workingDirectory, externalSessionId }),
    [agentEngine],
  );
  const readSessionHistory = useCallback(
    (
      repoPath: string,
      runtimeKind: RuntimeKind,
      workingDirectory: string,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionHistory({
        repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId,
      }),
    [agentEngine],
  );
  const readSessionSlashCommands = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      agentEngine.listAvailableSlashCommands({ repoPath, runtimeKind }),
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
      readSessionFileSearch,
    }),
    [
      readSessionFileSearch,
      readSessionHistory,
      readSessionModelCatalog,
      readSessionSlashCommands,
      readSessionTodos,
    ],
  );
};

import {
  DEFAULT_AGENT_RUNTIMES,
  type RepoRuntimeRef,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useMemo, useState } from "react";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import {
  ActiveWorkspaceContext,
  type ActiveWorkspaceContextValue,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "../app-state-contexts";
import { runtimeDefinitionsQueryOptions, runtimeQueryKeys } from "../queries/runtime";
import { settingsSnapshotQueryOptions } from "../queries/workspace";

type AppRuntimeProviderProps = PropsWithChildren<{
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  loadRepoRuntimeSlashCommands: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSlashCommandCatalog>;
  loadRepoRuntimeSkills: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentSkillCatalog>;
  loadRepoRuntimeSubagents: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSubagentCatalog>;
  loadRepoRuntimeFileSearch: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
}>;

export function AppRuntimeProvider({
  children,
  loadRepoRuntimeCatalog,
  loadRepoRuntimeSlashCommands,
  loadRepoRuntimeSkills,
  loadRepoRuntimeSubagents,
  loadRepoRuntimeFileSearch,
}: AppRuntimeProviderProps): ReactElement {
  const [activeWorkspace, setActiveWorkspace] =
    useState<ActiveWorkspaceContextValue["activeWorkspace"]>(null);
  const queryClient = useQueryClient();
  const {
    data: runtimeDefinitions = [],
    error,
    isPending: isLoadingRuntimeDefinitions,
    refetch,
  } = useQuery(runtimeDefinitionsQueryOptions());
  const {
    data: settingsSnapshot,
    error: settingsSnapshotError,
    isPending: isLoadingSettingsSnapshot,
  } = useQuery(settingsSnapshotQueryOptions());

  const activeWorkspaceValue = useMemo<ActiveWorkspaceContextValue>(
    () => ({
      activeWorkspace,
      setActiveWorkspace,
    }),
    [activeWorkspace],
  );

  const runtimeDefinitionsError = error
    ? errorMessage(error)
    : settingsSnapshotError
      ? `Failed to load runtime settings: ${errorMessage(settingsSnapshotError)}`
      : null;
  const agentRuntimes = settingsSnapshot?.agentRuntimes ?? DEFAULT_AGENT_RUNTIMES;
  const hasSettingsSnapshot = settingsSnapshot !== undefined;
  const availableRuntimeDefinitions = useMemo(
    () =>
      hasSettingsSnapshot
        ? getAvailableRuntimeDefinitions({ runtimeDefinitions, agentRuntimes })
        : [],
    [agentRuntimes, hasSettingsSnapshot, runtimeDefinitions],
  );

  const runtimeDefinitionsValue = useMemo<RuntimeDefinitionsContextValue>(
    () => ({
      runtimeDefinitions,
      availableRuntimeDefinitions,
      agentRuntimes,
      isLoadingRuntimeDefinitions: isLoadingRuntimeDefinitions || isLoadingSettingsSnapshot,
      runtimeDefinitionsError,
      refreshRuntimeDefinitions: async (): Promise<RuntimeDescriptor[]> => {
        await queryClient.invalidateQueries({
          queryKey: runtimeQueryKeys.definitions(),
        });
        const refreshResult = await refetch();
        if (refreshResult.error) {
          throw refreshResult.error;
        }
        return refreshResult.data ?? [];
      },
      loadRepoRuntimeCatalog,
      loadRepoRuntimeSlashCommands,
      loadRepoRuntimeSkills,
      loadRepoRuntimeSubagents,
      loadRepoRuntimeFileSearch,
    }),
    [
      agentRuntimes,
      availableRuntimeDefinitions,
      loadRepoRuntimeCatalog,
      loadRepoRuntimeFileSearch,
      loadRepoRuntimeSlashCommands,
      loadRepoRuntimeSkills,
      loadRepoRuntimeSubagents,
      isLoadingRuntimeDefinitions,
      isLoadingSettingsSnapshot,
      queryClient,
      refetch,
      runtimeDefinitions,
      runtimeDefinitionsError,
    ],
  );

  return (
    <ActiveWorkspaceContext.Provider value={activeWorkspaceValue}>
      <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue}>
        {children}
      </RuntimeDefinitionsContext.Provider>
    </ActiveWorkspaceContext.Provider>
  );
}

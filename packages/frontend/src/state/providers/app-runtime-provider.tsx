import {
  DEFAULT_AGENT_RUNTIMES,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
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
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>;
  loadRepoRuntimeSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  loadRepoRuntimeFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
}>;

export function AppRuntimeProvider({
  children,
  loadRepoRuntimeCatalog,
  loadRepoRuntimeSlashCommands,
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
  const { data: settingsSnapshot, isPending: isLoadingSettingsSnapshot } = useQuery(
    settingsSnapshotQueryOptions(),
  );

  const activeWorkspaceValue = useMemo<ActiveWorkspaceContextValue>(
    () => ({
      activeWorkspace,
      setActiveWorkspace,
    }),
    [activeWorkspace],
  );

  const runtimeDefinitionsError = error ? errorMessage(error) : null;
  const agentRuntimes = settingsSnapshot?.agentRuntimes ?? DEFAULT_AGENT_RUNTIMES;
  const availableRuntimeDefinitions = useMemo(
    () =>
      settingsSnapshot ? getAvailableRuntimeDefinitions({ runtimeDefinitions, agentRuntimes }) : [],
    [agentRuntimes, runtimeDefinitions, settingsSnapshot],
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
      loadRepoRuntimeFileSearch,
    }),
    [
      agentRuntimes,
      availableRuntimeDefinitions,
      loadRepoRuntimeCatalog,
      loadRepoRuntimeFileSearch,
      loadRepoRuntimeSlashCommands,
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

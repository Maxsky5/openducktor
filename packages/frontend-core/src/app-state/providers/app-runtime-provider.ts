import { DEFAULT_AGENT_RUNTIMES, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement, useMemo, useState } from "react";
import { getAvailableRuntimeDefinitions } from "../../lib/agent-runtime";
import { errorMessage } from "../../lib/errors";
import {
  ActiveWorkspaceContext,
  type ActiveWorkspaceContextValue,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "../app-state-contexts";
import { runtimeDefinitionsQueryOptions, runtimeQueryKeys } from "../../queries/runtime";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";

type AppRuntimeProviderProps = PropsWithChildren<{
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  loadRepoRuntimeFileSearch: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
}>;

export function AppRuntimeProvider({
  children,
  loadRepoRuntimeCatalog,
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
    isFetching: isFetchingRuntimeSettings,
    refetch: refetchRuntimeSettings,
  } = useQuery(settingsSnapshotQueryOptions());

  const activeWorkspaceValue = useMemo<ActiveWorkspaceContextValue>(
    () => ({
      activeWorkspace,
      setActiveWorkspace,
    }),
    [activeWorkspace],
  );

  const runtimeDefinitionsError = error ? errorMessage(error) : null;
  const runtimeSettingsError = settingsSnapshotError ? errorMessage(settingsSnapshotError) : null;
  const agentRuntimes = settingsSnapshot?.agentRuntimes ?? DEFAULT_AGENT_RUNTIMES;
  const hasSettingsSnapshot = settingsSnapshot !== undefined;
  // The settings load while no snapshot exists, also on a retry after an error. A refresh of a
  // loaded snapshot keeps this value, so it does not render every reader of the runtime context.
  const isLoadingRuntimeSettings = isFetchingRuntimeSettings && !hasSettingsSnapshot;
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
      isLoadingRuntimeDefinitions,
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
      isLoadingRuntimeSettings,
      runtimeSettingsError,
      hasRuntimeSettingsSnapshot: hasSettingsSnapshot,
      refreshRuntimeSettings: async (): Promise<void> => {
        const refreshResult = await refetchRuntimeSettings();
        if (refreshResult.error) {
          throw refreshResult.error;
        }
      },
      loadRepoRuntimeCatalog,
      loadRepoRuntimeFileSearch,
    }),
    [
      agentRuntimes,
      availableRuntimeDefinitions,
      loadRepoRuntimeCatalog,
      loadRepoRuntimeFileSearch,
      isLoadingRuntimeDefinitions,
      isLoadingRuntimeSettings,
      hasSettingsSnapshot,
      queryClient,
      refetch,
      refetchRuntimeSettings,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeSettingsError,
    ],
  );

  return createElement(
    ActiveWorkspaceContext.Provider,
    { value: activeWorkspaceValue },
    createElement(RuntimeDefinitionsContext.Provider, { value: runtimeDefinitionsValue }, children),
  );
}

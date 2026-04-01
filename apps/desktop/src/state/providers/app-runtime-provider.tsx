import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import {
  ActiveRepoContext,
  type ActiveRepoContextValue,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "../app-state-contexts";
import { runtimeDefinitionsQueryOptions, runtimeQueryKeys } from "../queries/runtime";

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
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const {
    data: runtimeDefinitions = [],
    error,
    isPending: isLoadingRuntimeDefinitions,
    refetch,
  } = useQuery(runtimeDefinitionsQueryOptions());

  const activeRepoValue = useMemo<ActiveRepoContextValue>(
    () => ({
      activeRepo,
      setActiveRepo,
    }),
    [activeRepo],
  );

  const runtimeDefinitionsError = error ? errorMessage(error) : null;

  const runtimeDefinitionsValue = useMemo<RuntimeDefinitionsContextValue>(
    () => ({
      runtimeDefinitions,
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
      loadRepoRuntimeCatalog,
      loadRepoRuntimeSlashCommands,
      loadRepoRuntimeFileSearch,
    }),
    [
      loadRepoRuntimeCatalog,
      loadRepoRuntimeFileSearch,
      loadRepoRuntimeSlashCommands,
      isLoadingRuntimeDefinitions,
      queryClient,
      refetch,
      runtimeDefinitions,
      runtimeDefinitionsError,
    ],
  );

  return (
    <ActiveRepoContext.Provider value={activeRepoValue}>
      <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue}>
        {children}
      </RuntimeDefinitionsContext.Provider>
    </ActiveRepoContext.Provider>
  );
}

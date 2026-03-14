import type { RuntimeDescriptor } from "@openducktor/contracts";
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

export function AppRuntimeProvider({ children }: PropsWithChildren): ReactElement {
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
    }),
    [
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

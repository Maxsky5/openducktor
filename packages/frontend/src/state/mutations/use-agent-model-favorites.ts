import type { AgentModelFavorite, SettingsSnapshot } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { AGENT_MODEL_FAVORITES_MUTATION_KEY } from "./agent-model-favorites";

type UseAgentModelFavoritesArgs = {
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
};

export type AgentModelFavoritesState = {
  favorites: AgentModelFavorite[] | null;
  isLoading: boolean;
  readError: string | null;
  isMutationPending: boolean;
  mutationError: string | null;
  canMutate: boolean;
  isFavorite: (favorite: AgentModelFavorite) => boolean;
  toggleFavorite: (favorite: AgentModelFavorite) => void;
  retryRead: () => void;
  retryMutation: () => void;
};

const isSameFavorite = (left: AgentModelFavorite, right: AgentModelFavorite): boolean =>
  left.runtimeKind === right.runtimeKind &&
  left.providerId === right.providerId &&
  left.modelId === right.modelId;

export function useAgentModelFavorites({
  saveAgentModelFavorites,
}: UseAgentModelFavoritesArgs): AgentModelFavoritesState {
  const queryClient = useQueryClient();
  const settingsOptions = settingsSnapshotQueryOptions();
  const settingsQuery = useQuery(settingsOptions);
  const mutation = useMutation({
    mutationKey: AGENT_MODEL_FAVORITES_MUTATION_KEY,
    mutationFn: saveAgentModelFavorites,
    onSuccess: (snapshot) => {
      queryClient.setQueryData(settingsOptions.queryKey, snapshot);
    },
  });
  const favorites = settingsQuery.data?.agentModelFavorites ?? null;

  const isFavorite = useCallback(
    (favorite: AgentModelFavorite): boolean =>
      favorites?.some((entry) => isSameFavorite(entry, favorite)) ?? false,
    [favorites],
  );

  const toggleFavorite = useCallback(
    (favorite: AgentModelFavorite): void => {
      if (favorites === null || mutation.isPending) {
        return;
      }
      const nextFavorites = isFavorite(favorite)
        ? favorites.filter((entry) => !isSameFavorite(entry, favorite))
        : [...favorites, favorite];
      mutation.mutate(nextFavorites);
    },
    [favorites, isFavorite, mutation],
  );

  const retryRead = useCallback((): void => {
    void settingsQuery.refetch();
  }, [settingsQuery]);

  const retryMutation = useCallback((): void => {
    if (mutation.variables && !mutation.isPending) {
      mutation.mutate(mutation.variables);
    }
  }, [mutation]);

  return {
    favorites,
    isLoading: settingsQuery.isLoading,
    readError: settingsQuery.error ? errorMessage(settingsQuery.error) : null,
    isMutationPending: mutation.isPending,
    mutationError: mutation.error ? errorMessage(mutation.error) : null,
    canMutate: favorites !== null && !mutation.isPending,
    isFavorite,
    toggleFavorite,
    retryRead,
    retryMutation,
  };
}

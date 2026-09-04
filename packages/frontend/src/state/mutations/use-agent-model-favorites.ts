import {
  type AgentModelFavorite,
  isSameAgentModelFavorite,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { AGENT_MODEL_FAVORITES_MUTATION_KEY } from "./agent-model-favorites";

type UseAgentModelFavoritesArgs = {
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
};

type FavoriteMutationIntent = {
  favorite: AgentModelFavorite;
  shouldBeFavorite: boolean;
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

const applyFavoriteMutationIntent = (
  favorites: AgentModelFavorite[],
  intent: FavoriteMutationIntent,
): AgentModelFavorite[] => {
  const withoutTarget = favorites.filter(
    (favorite) => !isSameAgentModelFavorite(favorite, intent.favorite),
  );
  return intent.shouldBeFavorite ? [...withoutTarget, intent.favorite] : withoutTarget;
};

export function useAgentModelFavorites({
  saveAgentModelFavorites,
}: UseAgentModelFavoritesArgs): AgentModelFavoritesState {
  const queryClient = useQueryClient();
  const settingsOptions = settingsSnapshotQueryOptions();
  const settingsQuery = useQuery(settingsOptions);
  const mutation = useMutation({
    mutationKey: AGENT_MODEL_FAVORITES_MUTATION_KEY,
    scope: { id: AGENT_MODEL_FAVORITES_MUTATION_KEY[0] },
    mutationFn: async (intent: FavoriteMutationIntent) => {
      const currentSnapshot = queryClient.getQueryData<SettingsSnapshot>(settingsOptions.queryKey);
      if (!currentSnapshot) {
        throw new Error("Cannot update model favorites before settings are available.");
      }
      return saveAgentModelFavorites(
        applyFavoriteMutationIntent(currentSnapshot.agentModelFavorites, intent),
      );
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData<SettingsSnapshot>(settingsOptions.queryKey, (current) =>
        current ? { ...current, agentModelFavorites: snapshot.agentModelFavorites } : snapshot,
      );
    },
  });
  const favorites = settingsQuery.data?.agentModelFavorites ?? null;
  const readError = settingsQuery.error ? errorMessage(settingsQuery.error) : null;

  const isFavorite = useCallback(
    (favorite: AgentModelFavorite): boolean =>
      favorites?.some((entry) => isSameAgentModelFavorite(entry, favorite)) ?? false,
    [favorites],
  );

  const toggleFavorite = useCallback(
    (favorite: AgentModelFavorite): void => {
      if (favorites === null || readError !== null || mutation.isPending) {
        return;
      }
      mutation.mutate({
        favorite,
        shouldBeFavorite: !isFavorite(favorite),
      });
    },
    [favorites, isFavorite, mutation, readError],
  );

  const retryRead = useCallback((): void => {
    void settingsQuery.refetch();
  }, [settingsQuery]);

  const retryMutation = useCallback((): void => {
    if (favorites !== null && readError === null && mutation.variables && !mutation.isPending) {
      mutation.mutate(mutation.variables);
    }
  }, [favorites, mutation, readError]);

  return {
    favorites,
    isLoading: settingsQuery.isLoading,
    readError,
    isMutationPending: mutation.isPending,
    mutationError: mutation.error ? errorMessage(mutation.error) : null,
    canMutate: favorites !== null && readError === null && !mutation.isPending,
    isFavorite,
    toggleFavorite,
    retryRead,
    retryMutation,
  };
}

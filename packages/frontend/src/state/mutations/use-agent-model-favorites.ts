import {
  type AgentModelFavorite,
  isSameAgentModelFavorite,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { AGENT_MODEL_FAVORITES_MUTATION_KEY } from "./agent-model-favorites";

type UseAgentModelFavoritesArgs = {
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
};

type FavoriteMutationIntent = {
  favorite: AgentModelFavorite;
  savedFavorites: AgentModelFavorite[];
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
  toggleFavorite: (
    favorite: AgentModelFavorite,
    savedFavorites?: readonly AgentModelFavorite[],
  ) => void;
  retryRead: () => void;
  retryMutation: () => void;
};

const applyFavoriteMutationIntent = (
  favorites: AgentModelFavorite[],
  intent: FavoriteMutationIntent,
): AgentModelFavorite[] => {
  const targets = [intent.favorite, ...intent.savedFavorites];
  const withoutTarget = favorites.filter(
    (favorite) => !targets.some((target) => isSameAgentModelFavorite(favorite, target)),
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
      queryClient.setQueryData(settingsOptions.queryKey, snapshot);
    },
  });
  const favorites = settingsQuery.data?.agentModelFavorites ?? null;
  const readError = settingsQuery.error ? errorMessage(settingsQuery.error) : null;
  const { mutate, isPending, variables } = mutation;
  const { refetch, isLoading } = settingsQuery;
  const mutationError = mutation.error ? errorMessage(mutation.error) : null;

  const isFavorite = useCallback(
    (favorite: AgentModelFavorite): boolean =>
      favorites?.some((entry) => isSameAgentModelFavorite(entry, favorite)) ?? false,
    [favorites],
  );

  const toggleFavorite = useCallback(
    (
      favorite: AgentModelFavorite,
      savedFavorites: readonly AgentModelFavorite[] = [favorite],
    ): void => {
      if (favorites === null || readError !== null || isPending) {
        return;
      }
      const saved = savedFavorites.filter(isFavorite);
      mutate({ favorite, savedFavorites: saved, shouldBeFavorite: saved.length === 0 });
    },
    [favorites, isFavorite, isPending, mutate, readError],
  );

  const retryRead = useCallback((): void => {
    void refetch();
  }, [refetch]);

  const retryMutation = useCallback((): void => {
    if (favorites !== null && readError === null && variables && !isPending) {
      mutate(variables);
    }
  }, [favorites, isPending, mutate, readError, variables]);

  return useMemo(
    () => ({
      favorites,
      isLoading,
      readError,
      isMutationPending: isPending,
      mutationError,
      canMutate: favorites !== null && readError === null && !isPending,
      isFavorite,
      toggleFavorite,
      retryRead,
      retryMutation,
    }),
    [
      favorites,
      isLoading,
      readError,
      isPending,
      mutationError,
      isFavorite,
      toggleFavorite,
      retryRead,
      retryMutation,
    ],
  );
}

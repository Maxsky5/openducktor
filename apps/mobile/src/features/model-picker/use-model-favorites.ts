import type { AgentModelFavorite } from "@openducktor/contracts";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type AgentModelFavoritesState,
  useAgentModelFavorites,
} from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import { useCallback } from "react";

/**
 * The model favorites of the host. Favorites are a host setting, so a star on the phone shows on
 * the desktop too. A change saves at once, as on desktop.
 */
export function useModelFavorites(): AgentModelFavoritesState {
  const host = useHostClient();
  const saveAgentModelFavorites = useCallback(
    (favorites: AgentModelFavorite[]) => host.workspaceUpdateAgentModelFavorites(favorites),
    [host],
  );
  return useAgentModelFavorites({ saveAgentModelFavorites });
}

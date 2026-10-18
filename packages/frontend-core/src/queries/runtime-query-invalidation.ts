import type { RuntimeKind } from "@openducktor/contracts";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { agentSessionContextQueryKeys } from "./agent-session-context";
import { agentSessionHistoryQueryKeys } from "./agent-session-history";
import { agentSessionTodosQueryKeys } from "./agent-session-todos";
import { runtimeCatalogQueryKeys } from "./runtime-catalog";
import { workspaceSessionExternalQueryKeys } from "./workspace-session-import";

// Each key-owning module matches its own key layout.
const RUNTIME_KIND_MATCHERS: ReadonlyArray<(key: QueryKey, runtimeKind: RuntimeKind) => boolean> = [
  agentSessionHistoryQueryKeys.matchesRuntimeKind,
  agentSessionTodosQueryKeys.matchesRuntimeKind,
  agentSessionContextQueryKeys.matchesRuntimeKind,
  runtimeCatalogQueryKeys.matchesCatalogRuntimeKind,
  workspaceSessionExternalQueryKeys.matchesRuntimeKind,
];

/**
 * A new runtime generation cannot serve reads cached from the old one. This covers every
 * workspace and directory of the kind. An active read refetches when the kind is ready; a read
 * of a kind that is not ready stays invalidated until the next read.
 */
export const invalidateRuntimeKindQueries = async (
  queryClient: QueryClient,
  runtimeKind: RuntimeKind,
  state: "ready" | "stopped",
): Promise<void> => {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) =>
      RUNTIME_KIND_MATCHERS.some((matches) => matches(query.queryKey, runtimeKind)),
  };
  await queryClient.cancelQueries(filters);
  await queryClient.invalidateQueries({
    ...filters,
    refetchType: state === "ready" ? "active" : "none",
  });
};

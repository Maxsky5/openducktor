import { knownRuntimeKindValues, type RuntimeKind } from "@openducktor/contracts";
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

const isRuntimeQueryKey = (key: QueryKey): boolean =>
  knownRuntimeKindValues.some((runtimeKind) =>
    RUNTIME_KIND_MATCHERS.some((matches) => matches(key, runtimeKind)),
  );

/**
 * Reads again each shown runtime read that failed. A runtime can fail a read for a short time,
 * such as when the computer wakes from sleep, and no event reads it again. A read that runs now can
 * still fail, such as one that ran during sleep, so it reads again after it fails. Each read
 * continues by itself, so a slow read does not delay the others. A read that fails again keeps its
 * error.
 */
export const refetchFailedRuntimeQueries = async (queryClient: QueryClient): Promise<void> => {
  const queries = queryClient.getQueryCache().findAll({
    type: "active",
    predicate: (query) =>
      (query.state.fetchStatus === "fetching" || query.state.status === "error") &&
      isRuntimeQueryKey(query.queryKey),
  });
  await Promise.all(
    queries.map(async (query) => {
      const filters = { queryKey: query.queryKey, exact: true, type: "active" } as const;
      // Without `cancelRefetch`, a refetch of a running read joins it instead of starting another.
      if (query.state.fetchStatus === "fetching") {
        await queryClient.refetchQueries(filters, { cancelRefetch: false });
      }
      if (query.state.status === "error") await queryClient.refetchQueries(filters);
    }),
  );
};

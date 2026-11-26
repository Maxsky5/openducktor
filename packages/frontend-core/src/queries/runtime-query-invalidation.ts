import { knownRuntimeKindValues, type RuntimeKind } from "@openducktor/contracts";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { agentSessionContextQueryKeys } from "./agent-session-context";
import { agentSessionHistoryQueryKeys } from "./agent-session-history";
import { agentSessionTodosQueryKeys } from "./agent-session-todos";
import {
  type CachedRuntimeCatalog,
  hasFailedCatalogSurface,
  runtimeCatalogQueryKeys,
} from "./runtime-catalog";
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

/** A catalog read can succeed with a failed surface. Its view shows that failure. */
const hasFailed = (query: Query): boolean => {
  if (query.state.status === "error") return true;
  const isCatalog = knownRuntimeKindValues.some((runtimeKind) =>
    runtimeCatalogQueryKeys.matchesCatalogRuntimeKind(query.queryKey, runtimeKind),
  );
  // SAFETY: each catalog key stores the `CachedRuntimeCatalog` of `catalogQueryOptions`.
  return isCatalog && hasFailedCatalogSurface(query.state.data as CachedRuntimeCatalog | undefined);
};

/** The queries that a recovery reads now. A later return skips them, and reads the others. */
const recovering = new WeakSet<Query>();

/**
 * Reads again each shown runtime read that failed. A runtime can fail a read for a short time,
 * such as when the computer wakes from sleep, and no event reads it again. A read that runs now can
 * still fail, such as one that ran during sleep, so it reads again after it fails. Each read
 * continues by itself, so a slow read does not delay the others, and one read recovers at a time.
 * A read that fails again keeps its error.
 */
export const refetchFailedRuntimeQueries = async (queryClient: QueryClient): Promise<void> => {
  const queries = queryClient.getQueryCache().findAll({
    type: "active",
    predicate: (query) =>
      !recovering.has(query) &&
      (query.state.fetchStatus === "fetching" || hasFailed(query)) &&
      isRuntimeQueryKey(query.queryKey),
  });
  await Promise.all(
    queries.map(async (query) => {
      recovering.add(query);
      const filters = { queryKey: query.queryKey, exact: true, type: "active" } as const;
      try {
        // Without `cancelRefetch`, a refetch of a running read joins it instead of starting another.
        if (query.state.fetchStatus === "fetching") {
          await queryClient.refetchQueries(filters, { cancelRefetch: false });
        }
        if (hasFailed(query)) await queryClient.refetchQueries(filters);
      } finally {
        recovering.delete(query);
      }
    }),
  );
};

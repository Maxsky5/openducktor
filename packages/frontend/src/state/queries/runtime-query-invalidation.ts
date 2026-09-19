import type { RepoRuntimeRef } from "@openducktor/contracts";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { agentSessionHistoryQueryKeys } from "./agent-session-history";
import { agentSessionTodosQueryKeys } from "./agent-session-todos";
import { runtimeCatalogQueryKeys } from "./runtime-catalog";

const matchesRuntimeSessionQueries = (key: QueryKey, scope: RepoRuntimeRef): boolean => {
  const repoPath = normalizeWorkingDirectory(scope.repoPath);
  return (
    (key[0] === agentSessionHistoryQueryKeys.all[0] ||
      key[0] === agentSessionTodosQueryKeys.all[0]) &&
    key[1] === repoPath &&
    key[2] === scope.runtimeKind
  );
};

// Match through the shared scope builder so the predicate follows the key shape.
const matchesRuntimeCatalogQueries = (key: QueryKey, scope: RepoRuntimeRef): boolean => {
  const catalogScope = runtimeCatalogQueryKeys.runtimeCatalogScope(scope);
  return catalogScope.every((segment, index) => key[index] === segment);
};

const invalidateMatchingQueries = async (
  queryClient: QueryClient,
  matches: (key: QueryKey) => boolean,
  state: "ready" | "stopped",
): Promise<void> => {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => matches(query.queryKey),
  };
  await queryClient.cancelQueries(filters);
  await queryClient.invalidateQueries({
    ...filters,
    refetchType: state === "ready" ? "active" : "none",
  });
};

// The runtime lifecycle event reports a runtime start or stop. The host publishes it
// only when a runtime instance starts or stops, and a replaced instance cannot serve
// cached session reads or cached catalogs. Invalidate both. An active read refetches
// on the ready event; a stopped runtime leaves its entries invalidated, so the next
// read loads the new instance or fails with the runtime-unavailable message.
export const invalidateRuntimeQueries = (
  queryClient: QueryClient,
  scope: RepoRuntimeRef,
  state: "ready" | "stopped",
): Promise<void> =>
  invalidateMatchingQueries(
    queryClient,
    (key) => matchesRuntimeSessionQueries(key, scope) || matchesRuntimeCatalogQueries(key, scope),
    state,
  );

// The lifecycle ready callback fires on every runtime ensure, including a workspace
// switch that reuses a running runtime. Session reads are instance-bound and must
// refresh. Catalogs are not instance-bound and stay cached across a switch.
export const invalidateRuntimeSessionQueries = (
  queryClient: QueryClient,
  scope: RepoRuntimeRef,
  state: "ready" | "stopped",
): Promise<void> =>
  invalidateMatchingQueries(queryClient, (key) => matchesRuntimeSessionQueries(key, scope), state);

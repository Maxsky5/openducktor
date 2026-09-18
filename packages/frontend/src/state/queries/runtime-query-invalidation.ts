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

const matchesRuntimeCatalogQueries = (key: QueryKey, scope: RepoRuntimeRef): boolean => {
  const repoPath = normalizeWorkingDirectory(scope.repoPath);
  return (
    key[0] === runtimeCatalogQueryKeys.all[0] && key[2] === repoPath && key[3] === scope.runtimeKind
  );
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

// A runtime ready event fires on every ensure, including a workspace switch that
// reuses a running runtime. Session reads are instance-bound, but the catalog is
// not, and it stays cached so a switch does not re-read every runtime.
export const invalidateRuntimeSessionQueries = (
  queryClient: QueryClient,
  scope: RepoRuntimeRef,
  state: "ready" | "stopped",
): Promise<void> =>
  invalidateMatchingQueries(queryClient, (key) => matchesRuntimeSessionQueries(key, scope), state);

// A real runtime replacement can change the catalog, so it invalidates catalog
// reads too. Catalog change events (catalog_invalidated, slash_command_catalog_updated)
// remain the primary refresh signal.
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

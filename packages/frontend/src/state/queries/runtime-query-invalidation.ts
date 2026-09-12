import type { RepoRuntimeRef } from "@openducktor/contracts";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { agentSessionHistoryQueryKeys } from "./agent-session-history";
import { agentSessionTodosQueryKeys } from "./agent-session-todos";
import { runtimeCatalogQueryKeys } from "./runtime-catalog";

export const invalidateRuntimeQueries = async (
  queryClient: QueryClient,
  scope: RepoRuntimeRef,
  state: "ready" | "stopped",
): Promise<void> => {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => matchesRuntime(query.queryKey, scope),
  };
  await queryClient.cancelQueries(filters);
  await queryClient.invalidateQueries({
    ...filters,
    refetchType: state === "ready" ? "active" : "none",
  });
};

const matchesRuntime = (key: QueryKey, scope: RepoRuntimeRef): boolean => {
  const repoPath = normalizeWorkingDirectory(scope.repoPath);
  if (key[0] === runtimeCatalogQueryKeys.all[0]) {
    return (
      (key[1] === repoPath && key[2] === scope.runtimeKind) ||
      (key[2] === repoPath && key[3] === scope.runtimeKind)
    );
  }
  return (
    (key[0] === agentSessionHistoryQueryKeys.all[0] ||
      key[0] === agentSessionTodosQueryKeys.all[0]) &&
    key[1] === repoPath &&
    key[2] === scope.runtimeKind
  );
};

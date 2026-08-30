import type { AgentRole } from "@openducktor/core";
import type { SetURLSearchParams } from "react-router";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import { useRepoNavigationPersistence } from "./use-repo-navigation-persistence";

type UseAgentStudioQuerySyncArgs = {
  activeWorkspaceId: string | null;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

export function useAgentStudioQuerySync({
  activeWorkspaceId,
  locationKey,
  navigationType,
  searchParams,
  setSearchParams,
}: UseAgentStudioQuerySyncArgs) {
  const { navigation, setNavigation, updateQuery } = useNavigationUrlSync({
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
  });

  const { isRepoNavigationBoundaryPending, persistenceError, retryPersistenceRestore } =
    useRepoNavigationPersistence({
      activeWorkspaceId,
      navigation,
      setNavigation,
    });

  const hasExplicitRoleParam = navigation.role !== null;
  const roleFromQuery: AgentRole = navigation.role ?? "spec";

  return {
    taskIdParam: navigation.taskId,
    sessionExternalIdParam: navigation.sessionExternalId,
    hasExplicitRoleParam,
    roleFromQuery,
    isRepoNavigationBoundaryPending,
    navigationPersistenceError: persistenceError,
    retryNavigationPersistence: retryPersistenceRestore,
    updateQuery,
  } satisfies {
    taskIdParam: string;
    sessionExternalIdParam: string | null;
    hasExplicitRoleParam: boolean;
    roleFromQuery: AgentRole;
    isRepoNavigationBoundaryPending: boolean;
    navigationPersistenceError: Error | null;
    retryNavigationPersistence: () => void;
    updateQuery: (updates: AgentStudioQueryUpdate) => void;
  };
}

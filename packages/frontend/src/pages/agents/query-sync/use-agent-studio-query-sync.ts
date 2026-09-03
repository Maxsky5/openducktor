import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { SetURLSearchParams } from "react-router";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import { useRepoNavigationPersistence } from "./use-repo-navigation-persistence";

type UseAgentStudioQuerySyncArgs = {
  activeWorkspaceId: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isLoadingAgentStudioState: boolean;
  agentStudioStateError: Error | null;
  retryAgentStudioStateLoad: () => void;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

export function useAgentStudioQuerySync({
  activeWorkspaceId,
  agentStudioState,
  isLoadingAgentStudioState,
  agentStudioStateError,
  retryAgentStudioStateLoad,
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

  const {
    isRepoNavigationBoundaryPending,
    isWorkspaceStateLoaded,
    persistenceError,
    retryPersistenceRestore,
  } = useRepoNavigationPersistence({
    activeWorkspaceId,
    agentStudioState,
    isLoadingAgentStudioState,
    agentStudioStateError,
    navigation,
    retryPersistenceRestore: retryAgentStudioStateLoad,
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
    isWorkspaceStateLoaded,
    navigationPersistenceError: persistenceError,
    retryNavigationPersistence: retryPersistenceRestore,
    updateQuery,
  } satisfies {
    taskIdParam: string;
    sessionExternalIdParam: string | null;
    hasExplicitRoleParam: boolean;
    roleFromQuery: AgentRole;
    isRepoNavigationBoundaryPending: boolean;
    isWorkspaceStateLoaded: boolean;
    navigationPersistenceError: Error | null;
    retryNavigationPersistence: () => void;
    updateQuery: (updates: AgentStudioQueryUpdate) => void;
  };
}

import type { AgentRole } from "@openducktor/core";
import type { SetURLSearchParams } from "react-router-dom";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import { useRepoNavigationPersistence } from "./use-repo-navigation-persistence";

type UseAgentStudioQuerySyncArgs = {
  activeWorkspace: ActiveWorkspace | null;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

export function useAgentStudioQuerySync({
  activeWorkspace,
  navigationType,
  searchParams,
  setSearchParams,
}: UseAgentStudioQuerySyncArgs): {
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  isRepoNavigationBoundaryPending: boolean;
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: () => void;
  updateQuery: (updates: AgentStudioQueryUpdate) => void;
} {
  const { navigation, setNavigation, updateQuery } = useNavigationUrlSync({
    navigationType,
    searchParams,
    setSearchParams,
  });

  const { isRepoNavigationBoundaryPending, persistenceError, retryPersistenceRestore } =
    useRepoNavigationPersistence({
      activeWorkspace,
      navigation,
      setNavigation,
    });

  const hasExplicitRoleParam = navigation.role !== null;
  const roleFromQuery: AgentRole = navigation.role ?? "spec";

  return {
    taskIdParam: navigation.taskId,
    sessionParam: navigation.externalSessionId,
    hasExplicitRoleParam,
    roleFromQuery,
    isRepoNavigationBoundaryPending,
    navigationPersistenceError: persistenceError,
    retryNavigationPersistence: retryPersistenceRestore,
    updateQuery,
  };
}

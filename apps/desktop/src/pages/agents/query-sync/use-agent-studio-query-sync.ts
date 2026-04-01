import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { SetURLSearchParams } from "react-router-dom";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import { useRepoNavigationPersistence } from "./use-repo-navigation-persistence";

type UseAgentStudioQuerySyncArgs = {
  activeRepo: string | null;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

export function useAgentStudioQuerySync({
  activeRepo,
  navigationType,
  searchParams,
  setSearchParams,
}: UseAgentStudioQuerySyncArgs): {
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  scenarioFromQuery: AgentScenario | null;
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
      activeRepo,
      navigation,
      setNavigation,
    });

  const hasExplicitRoleParam = navigation.role !== null;
  const roleFromQuery: AgentRole = navigation.role ?? "spec";

  return {
    taskIdParam: navigation.taskId,
    sessionParam: navigation.sessionId,
    hasExplicitRoleParam,
    roleFromQuery,
    scenarioFromQuery: navigation.scenario,
    isRepoNavigationBoundaryPending,
    navigationPersistenceError: persistenceError,
    retryNavigationPersistence: retryPersistenceRestore,
    updateQuery,
  };
}

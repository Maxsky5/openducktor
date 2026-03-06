import type { AgentRole } from "@openducktor/core";
import type { SetURLSearchParams } from "react-router-dom";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import { useRepoNavigationPersistence } from "./use-repo-navigation-persistence";

type UseAgentStudioQuerySyncArgs = {
  activeRepo: string | null;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

export function useAgentStudioQuerySync({
  activeRepo,
  searchParams,
  setSearchParams,
}: UseAgentStudioQuerySyncArgs): {
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  updateQuery: (updates: AgentStudioQueryUpdate) => void;
} {
  const { navigation, setNavigation, updateQuery } = useNavigationUrlSync({
    searchParams,
    setSearchParams,
  });

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
    updateQuery,
  };
}

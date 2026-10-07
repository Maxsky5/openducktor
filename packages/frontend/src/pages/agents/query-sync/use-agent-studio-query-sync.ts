import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useState } from "react";
import type { SetURLSearchParams } from "react-router";
import {
  type AgentStudioQueryUpdate,
  clearAgentStudioNavigationState,
  hasAgentStudioNavigationSelection,
  parseNavigationStateFromSearchParams,
  restoreNavigationFromWorkspaceState,
} from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

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
  const startsWithWorkspaceState =
    activeWorkspaceId !== null &&
    agentStudioState !== null &&
    !isLoadingAgentStudioState &&
    agentStudioStateError === null;
  const { workspaceChanged, isWorkspaceStateLoaded, markRestored } = useWorkspaceRestore(
    activeWorkspaceId,
    startsWithWorkspaceState,
  );
  const parsedNavigation = parseNavigationStateFromSearchParams(searchParams);
  // A direct link belongs to its named workspace. A rail switch drops the old selection.
  const searchNavigation =
    workspaceChanged && searchParams.get("workspace") !== activeWorkspaceId
      ? clearAgentStudioNavigationState(parsedNavigation)
      : parsedNavigation;
  const initialNavigation =
    startsWithWorkspaceState && !hasAgentStudioNavigationSelection(searchNavigation)
      ? restoreNavigationFromWorkspaceState(searchNavigation, agentStudioState)
      : searchNavigation;
  const { navigation, setNavigation, updateQuery } = useNavigationUrlSync({
    workspaceId: activeWorkspaceId,
    initialNavigation,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
  });
  const isWorkspaceRestorePending =
    activeWorkspaceId !== null &&
    !isWorkspaceStateLoaded &&
    agentStudioStateError === null &&
    !hasAgentStudioNavigationSelection(navigation);

  if (!workspaceChanged && startsWithWorkspaceState && !isWorkspaceStateLoaded) {
    setNavigation((current) => {
      if (hasAgentStudioNavigationSelection(current)) {
        return current;
      }
      return restoreNavigationFromWorkspaceState(current, agentStudioState);
    });
    markRestored();
  }

  const hasExplicitRoleParam = navigation.role !== null;
  const roleFromQuery: AgentRole = navigation.role ?? "spec";

  return {
    taskIdParam: navigation.taskId,
    sessionExternalIdParam: navigation.sessionExternalId,
    sessionIdentityParam: navigation.sessionIdentity,
    hasExplicitRoleParam,
    roleFromQuery,
    isWorkspaceRestorePending,
    isWorkspaceStateLoaded,
    navigationPersistenceError: agentStudioStateError,
    retryNavigationPersistence: retryAgentStudioStateLoad,
    updateQuery,
  } satisfies {
    taskIdParam: string;
    sessionExternalIdParam: string | null;
    sessionIdentityParam: AgentSessionIdentity | null;
    hasExplicitRoleParam: boolean;
    roleFromQuery: AgentRole;
    isWorkspaceRestorePending: boolean;
    isWorkspaceStateLoaded: boolean;
    navigationPersistenceError: Error | null;
    retryNavigationPersistence: () => void;
    updateQuery: (updates: AgentStudioQueryUpdate) => void;
  };
}

// Restore preferences once per workspace visit, so later reads keep the user's selection.
function useWorkspaceRestore(workspaceId: string | null, ready: boolean) {
  const [restore, setRestore] = useState(() => ({ workspaceId, loaded: ready }));
  const workspaceChanged = restore.workspaceId !== workspaceId;
  if (workspaceChanged) setRestore({ workspaceId, loaded: ready });
  const isWorkspaceStateLoaded =
    workspaceId !== null && restore.workspaceId === workspaceId && restore.loaded;
  const markRestored = () => setRestore((current) => ({ ...current, loaded: true }));
  return { workspaceChanged, isWorkspaceStateLoaded, markRestored };
}

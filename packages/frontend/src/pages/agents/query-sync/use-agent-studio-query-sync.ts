import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useState } from "react";
import type { SetURLSearchParams } from "react-router";
import {
  type AgentStudioNavigationState,
  type AgentStudioQueryUpdate,
  clearAgentStudioNavigationState,
  hasAgentStudioNavigationSelection,
  isSameNavigationState,
  parseNavigationStateFromSearchParams,
  restoreNavigationFromWorkspaceState,
} from "./agent-studio-navigation";
import { taskRouteStateSchema, readTaskRouteIntent } from "./task-route-intent";
import { useNavigationUrlSync } from "./use-navigation-url-sync";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

type UseAgentStudioQuerySyncArgs = {
  activeWorkspaceId: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isLoadingAgentStudioState: boolean;
  agentStudioStateError: Error | null;
  retryAgentStudioStateLoad: () => void;
  locationKey: string;
  locationState?: unknown;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  enabled?: boolean;
};

export function useAgentStudioQuerySync({
  activeWorkspaceId,
  agentStudioState,
  isLoadingAgentStudioState,
  agentStudioStateError,
  retryAgentStudioStateLoad,
  locationKey,
  locationState,
  navigationType,
  searchParams,
  setSearchParams,
  enabled = true,
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
  const parsedState = taskRouteStateSchema.safeParse(locationState);
  const routeState = parsedState.success ? parsedState.data : {};
  const parsedNavigation = readTaskRouteIntent(
    parseNavigationStateFromSearchParams(searchParams),
    activeWorkspaceId,
    routeState,
  );
  const initialNavigation = readTaskRouteIntent(
    navigationForWorkspace(
      searchParams,
      activeWorkspaceId,
      workspaceChanged,
      startsWithWorkspaceState ? agentStudioState : null,
    ),
    activeWorkspaceId,
    routeState,
  );
  const { navigation, setNavigation, updateQuery } = useNavigationUrlSync({
    workspaceId: activeWorkspaceId,
    initialNavigation,
    locationKey,
    locationState,
    navigationType,
    searchParams,
    setSearchParams,
    enabled,
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

  const shown = searchParams.has("task") ? parsedNavigation : navigation;
  const hasExplicitRoleParam = shown.role !== null;
  const roleFromQuery: AgentRole = shown.role ?? "spec";

  return {
    taskIdParam: shown.taskId,
    sessionExternalIdParam: shown.sessionExternalId,
    sessionIdentityParam: shown.sessionIdentity,
    hasExplicitRoleParam,
    keepSessionlessParam: shown.keepSessionless ?? false,
    roleFromQuery,
    isNavigationPending: !isSameNavigationState(parsedNavigation, navigation),
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
    keepSessionlessParam: boolean;
    roleFromQuery: AgentRole;
    isNavigationPending: boolean;
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

function navigationForWorkspace(
  searchParams: URLSearchParams,
  workspaceId: string | null,
  workspaceChanged: boolean,
  state: WorkspaceAgentStudioState | null,
): AgentStudioNavigationState {
  const parsed = parseNavigationStateFromSearchParams(searchParams);
  // A direct link belongs to its named workspace. A rail switch drops the old selection.
  const navigation =
    workspaceChanged && searchParams.get("workspace") !== workspaceId
      ? clearAgentStudioNavigationState(parsed)
      : parsed;
  return state && !hasAgentStudioNavigationSelection(navigation)
    ? restoreNavigationFromWorkspaceState(navigation, state)
    : navigation;
}

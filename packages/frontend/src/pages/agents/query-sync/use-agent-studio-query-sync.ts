import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useEffect, useReducer, useRef } from "react";
import type { SetURLSearchParams } from "react-router";
import {
  type AgentStudioQueryUpdate,
  clearAgentStudioNavigationState,
  hasAgentStudioNavigationSelection,
  parseNavigationStateFromSearchParams,
  restoreNavigationFromWorkspaceState,
} from "./agent-studio-navigation";
import { useNavigationUrlSync } from "./use-navigation-url-sync";

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

export type WorkspaceRestorePhase = "idle" | "detecting" | "clearing";

type WorkspaceRestoreState = {
  boundaryWorkspaceId: string | null;
  restoredWorkspaceId: string | null;
};

type WorkspaceRestoreAction =
  | {
      type: "workspaceChanged";
      activeWorkspaceId: string | null;
      previousWorkspaceId: string | null;
    }
  | { type: "boundaryCleared" }
  | { type: "workspaceRestored"; workspaceId: string };

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
  const searchNavigation = parseNavigationStateFromSearchParams(searchParams);
  const startsWithWorkspaceState =
    activeWorkspaceId !== null &&
    agentStudioState !== null &&
    !isLoadingAgentStudioState &&
    agentStudioStateError === null;
  const initialNavigation =
    startsWithWorkspaceState && !hasAgentStudioNavigationSelection(searchNavigation)
      ? restoreNavigationFromWorkspaceState(searchNavigation, agentStudioState)
      : searchNavigation;
  const { navigation, setNavigation, updateQuery } = useNavigationUrlSync({
    initialNavigation,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
  });
  const lastWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const [{ boundaryWorkspaceId, restoredWorkspaceId }, dispatchRestore] = useReducer(
    workspaceRestoreReducer,
    {
      boundaryWorkspaceId: null,
      restoredWorkspaceId: startsWithWorkspaceState ? activeWorkspaceId : null,
    },
  );
  const restorePhase = getWorkspaceRestorePhase({
    activeWorkspaceId,
    lastWorkspaceId: lastWorkspaceIdRef.current,
    boundaryWorkspaceId,
  });
  const isWorkspaceStateLoaded =
    activeWorkspaceId !== null && restoredWorkspaceId === activeWorkspaceId;
  const isWorkspaceRestorePending =
    restorePhase !== "idle" ||
    (activeWorkspaceId !== null &&
      !isWorkspaceStateLoaded &&
      agentStudioStateError === null &&
      !hasAgentStudioNavigationSelection(navigation));

  useEffect(() => {
    if (lastWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }

    const previousWorkspaceId = lastWorkspaceIdRef.current;
    lastWorkspaceIdRef.current = activeWorkspaceId;
    dispatchRestore({ type: "workspaceChanged", activeWorkspaceId, previousWorkspaceId });
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId || restorePhase !== "clearing") {
      return;
    }

    if (!hasAgentStudioNavigationSelection(navigation)) {
      dispatchRestore({ type: "boundaryCleared" });
      return;
    }

    setNavigation((current) => clearAgentStudioNavigationState(current));
  }, [activeWorkspaceId, navigation, restorePhase, setNavigation]);

  useEffect(() => {
    if (
      !activeWorkspaceId ||
      !agentStudioState ||
      isLoadingAgentStudioState ||
      agentStudioStateError ||
      restorePhase !== "idle" ||
      restoredWorkspaceId === activeWorkspaceId
    ) {
      return;
    }

    setNavigation((current) => {
      if (hasAgentStudioNavigationSelection(current)) {
        return current;
      }
      return restoreNavigationFromWorkspaceState(current, agentStudioState);
    });
    dispatchRestore({ type: "workspaceRestored", workspaceId: activeWorkspaceId });
  }, [
    activeWorkspaceId,
    agentStudioState,
    agentStudioStateError,
    isLoadingAgentStudioState,
    restorePhase,
    restoredWorkspaceId,
    setNavigation,
  ]);

  const hasExplicitRoleParam = navigation.role !== null;
  const roleFromQuery: AgentRole = navigation.role ?? "spec";

  return {
    taskIdParam: navigation.taskId,
    sessionExternalIdParam: navigation.sessionExternalId,
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
    hasExplicitRoleParam: boolean;
    roleFromQuery: AgentRole;
    isWorkspaceRestorePending: boolean;
    isWorkspaceStateLoaded: boolean;
    navigationPersistenceError: Error | null;
    retryNavigationPersistence: () => void;
    updateQuery: (updates: AgentStudioQueryUpdate) => void;
  };
}

export const getWorkspaceRestorePhase = ({
  activeWorkspaceId,
  lastWorkspaceId,
  boundaryWorkspaceId,
}: {
  activeWorkspaceId: string | null;
  lastWorkspaceId: string | null;
  boundaryWorkspaceId: string | null;
}): WorkspaceRestorePhase => {
  if (!activeWorkspaceId) {
    return "idle";
  }

  if (lastWorkspaceId && lastWorkspaceId !== activeWorkspaceId) {
    return "detecting";
  }

  if (boundaryWorkspaceId === activeWorkspaceId) {
    return "clearing";
  }

  return "idle";
};

const workspaceRestoreReducer = (
  state: WorkspaceRestoreState,
  action: WorkspaceRestoreAction,
): WorkspaceRestoreState => {
  switch (action.type) {
    case "workspaceChanged": {
      const boundaryWorkspaceId =
        action.previousWorkspaceId && action.activeWorkspaceId ? action.activeWorkspaceId : null;
      return { boundaryWorkspaceId, restoredWorkspaceId: null };
    }
    case "boundaryCleared":
      return { ...state, boundaryWorkspaceId: null };
    case "workspaceRestored":
      return { ...state, restoredWorkspaceId: action.workspaceId };
  }
};

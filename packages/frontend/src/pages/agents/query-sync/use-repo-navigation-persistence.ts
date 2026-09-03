import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useReducer, useRef } from "react";
import {
  type AgentStudioNavigationState,
  clearAgentStudioNavigationState,
  hasAgentStudioNavigationSelection,
  restoreNavigationFromWorkspaceState,
} from "./agent-studio-navigation";

type UseRepoNavigationPersistenceArgs = {
  activeWorkspaceId: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isLoadingAgentStudioState: boolean;
  agentStudioStateError: Error | null;
  navigation: AgentStudioNavigationState;
  retryPersistenceRestore: () => void;
  setNavigation: Dispatch<SetStateAction<AgentStudioNavigationState>>;
};

type UseRepoNavigationPersistenceResult = {
  isRepoNavigationBoundaryPending: boolean;
  isWorkspaceStateLoaded: boolean;
  persistenceError: Error | null;
  retryPersistenceRestore: () => void;
};

export type RepoNavigationBoundaryPhase = "idle" | "detecting" | "clearing";

type RepoNavigationRestoreState = {
  boundaryWorkspaceId: string | null;
  restoredWorkspaceId: string | null;
};

type RepoNavigationRestoreAction =
  | {
      type: "workspaceChanged";
      activeWorkspaceId: string | null;
      previousWorkspaceId: string | null;
    }
  | { type: "boundaryCleared" }
  | { type: "workspaceRestored"; workspaceId: string };

const repoNavigationRestoreReducer = (
  state: RepoNavigationRestoreState,
  action: RepoNavigationRestoreAction,
): RepoNavigationRestoreState => {
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

export const resolveRepoNavigationBoundaryPhase = ({
  activeWorkspaceId,
  lastWorkspaceId,
  boundaryWorkspaceId,
}: {
  activeWorkspaceId: string | null;
  lastWorkspaceId: string | null;
  boundaryWorkspaceId: string | null;
}): RepoNavigationBoundaryPhase => {
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

export function useRepoNavigationPersistence({
  activeWorkspaceId,
  agentStudioState,
  isLoadingAgentStudioState,
  agentStudioStateError,
  navigation,
  retryPersistenceRestore,
  setNavigation,
}: UseRepoNavigationPersistenceArgs): UseRepoNavigationPersistenceResult {
  const lastWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const [{ boundaryWorkspaceId, restoredWorkspaceId }, dispatchRestore] = useReducer(
    repoNavigationRestoreReducer,
    {
      boundaryWorkspaceId: null,
      restoredWorkspaceId: null,
    },
  );
  const repoNavigationBoundaryPhase = resolveRepoNavigationBoundaryPhase({
    activeWorkspaceId,
    lastWorkspaceId: lastWorkspaceIdRef.current,
    boundaryWorkspaceId,
  });
  const isWorkspaceStateLoaded =
    activeWorkspaceId !== null && restoredWorkspaceId === activeWorkspaceId;
  const isRepoNavigationBoundaryPending =
    repoNavigationBoundaryPhase !== "idle" ||
    (activeWorkspaceId !== null && !isWorkspaceStateLoaded && agentStudioStateError === null);

  useEffect(() => {
    if (lastWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }

    const previousWorkspaceId = lastWorkspaceIdRef.current;
    lastWorkspaceIdRef.current = activeWorkspaceId;
    dispatchRestore({ type: "workspaceChanged", activeWorkspaceId, previousWorkspaceId });
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId || repoNavigationBoundaryPhase !== "clearing") {
      return;
    }

    if (!hasAgentStudioNavigationSelection(navigation)) {
      dispatchRestore({ type: "boundaryCleared" });
      return;
    }

    setNavigation((current) => clearAgentStudioNavigationState(current));
  }, [activeWorkspaceId, navigation, repoNavigationBoundaryPhase, setNavigation]);

  useEffect(() => {
    if (
      !activeWorkspaceId ||
      !agentStudioState ||
      isLoadingAgentStudioState ||
      agentStudioStateError ||
      repoNavigationBoundaryPhase !== "idle" ||
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
    repoNavigationBoundaryPhase,
    restoredWorkspaceId,
    setNavigation,
  ]);

  return {
    isRepoNavigationBoundaryPending,
    isWorkspaceStateLoaded,
    persistenceError: agentStudioStateError,
    retryPersistenceRestore,
  };
}

import type { AgentRole } from "@openducktor/core";
import { useCallback, useState } from "react";
import type { AgentStudioSessionRouteParam } from "../query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectionIntent,
  isSelectionIntentResolved,
} from "./agent-studio-selection-intent";

type UseAgentStudioSelectionIntentStateArgs = {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionParam: AgentStudioSessionRouteParam | null;
  roleFromQuery: AgentRole;
};

export type AgentStudioSelectionIntentState = {
  selectionIntentForController: AgentStudioSelectionIntent | null;
  isSessionSelectionResolving: boolean;
  scheduleSelectionIntent: (intent: AgentStudioSelectionIntent) => void;
};

export function useAgentStudioSelectionIntentState({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionParam,
  roleFromQuery,
}: UseAgentStudioSelectionIntentStateArgs): AgentStudioSelectionIntentState {
  const [selectionIntent, setSelectionIntent] = useState<AgentStudioSelectionIntent | null>(null);
  const [sessionlessSelection, setSessionlessSelection] =
    useState<AgentStudioSelectionIntent | null>(null);

  const scheduleSelectionIntent = useCallback((intent: AgentStudioSelectionIntent): void => {
    setSelectionIntent(intent);
    setSessionlessSelection(intent.session === null ? intent : null);
  }, []);

  const activeSessionlessSelection =
    sessionlessSelection &&
    sessionlessSelection.taskId === taskIdParam &&
    sessionlessSelection.role === roleFromQuery &&
    sessionParam === null
      ? sessionlessSelection
      : null;

  if (isRepoNavigationBoundaryPending) {
    if (selectionIntent !== null) {
      setSelectionIntent(null);
    }
  } else if (selectionIntent) {
    const selectionIntentResolved = isSelectionIntentResolved({
      selectionIntent,
      taskIdParam,
      sessionParam,
      roleFromQuery,
    });

    if (selectionIntentResolved) {
      setSelectionIntent(null);
    }
  }

  const isSessionSelectionResolving = Boolean(
    selectionIntent &&
      !isRepoNavigationBoundaryPending &&
      !isSelectionIntentResolved({
        selectionIntent,
        taskIdParam,
        sessionParam,
        roleFromQuery,
      }),
  );

  return {
    selectionIntentForController: selectionIntent ?? activeSessionlessSelection,
    isSessionSelectionResolving,
    scheduleSelectionIntent,
  };
}

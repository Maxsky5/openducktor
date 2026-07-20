import type { AgentRole } from "@openducktor/core";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectionState,
  agentStudioSelectionQueryKey,
  buildAgentStudioSelectionQueryUpdateFromState,
  createAgentStudioRouteSelectionState,
  type SelectAgentStudioSelection,
} from "./agent-studio-selection-state";

type UseAgentStudioSelectionStateArgs = {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
};

type SelectionStateSnapshot = {
  routeQueryKey: string;
  selection: AgentStudioSelectionState;
};

export type AgentStudioSelectionStateModel = {
  selection: AgentStudioSelectionState;
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export function useAgentStudioSelectionState({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionExternalIdParam,
  hasExplicitRoleParam,
  roleFromQuery,
  scheduleQueryUpdate,
}: UseAgentStudioSelectionStateArgs): AgentStudioSelectionStateModel {
  const routeSelection = useMemo(
    () =>
      createAgentStudioRouteSelectionState({
        isRepoNavigationBoundaryPending,
        taskIdParam,
        sessionExternalIdParam,
        hasExplicitRoleParam,
        roleFromQuery,
      }),
    [
      hasExplicitRoleParam,
      isRepoNavigationBoundaryPending,
      roleFromQuery,
      sessionExternalIdParam,
      taskIdParam,
    ],
  );
  const routeSelectionQueryKey = useMemo(
    () => agentStudioSelectionQueryKey(routeSelection),
    [routeSelection],
  );
  const [snapshot, setSnapshot] = useState<SelectionStateSnapshot>(() => ({
    routeQueryKey: routeSelectionQueryKey,
    selection: routeSelection,
  }));

  const snapshotSelectionQueryKey = agentStudioSelectionQueryKey(snapshot.selection);
  const hasRouteChangedOutsideLocalSelection =
    snapshot.routeQueryKey !== routeSelectionQueryKey &&
    snapshotSelectionQueryKey !== routeSelectionQueryKey;
  const selection = hasRouteChangedOutsideLocalSelection ? routeSelection : snapshot.selection;

  useLayoutEffect(() => {
    setSnapshot((current) => {
      const currentSelectionQueryKey = agentStudioSelectionQueryKey(current.selection);
      if (current.routeQueryKey === routeSelectionQueryKey) {
        return current;
      }
      if (currentSelectionQueryKey === routeSelectionQueryKey) {
        return {
          routeQueryKey: routeSelectionQueryKey,
          selection: current.selection,
        };
      }
      return {
        routeQueryKey: routeSelectionQueryKey,
        selection: routeSelection,
      };
    });
  }, [routeSelection, routeSelectionQueryKey]);

  const selectAgentStudioSelection = useCallback<SelectAgentStudioSelection>(
    (nextSelection) => {
      setSnapshot({
        routeQueryKey: routeSelectionQueryKey,
        selection: nextSelection,
      });
      scheduleQueryUpdate(buildAgentStudioSelectionQueryUpdateFromState(nextSelection));
    },
    [routeSelectionQueryKey, scheduleQueryUpdate],
  );

  return {
    selection,
    selectAgentStudioSelection,
  };
}

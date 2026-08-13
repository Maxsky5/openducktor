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
  requestContextTransition: (applyTransition: () => void, cancelTransition?: () => void) => void;
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
  requestContextTransition,
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

  const selection = snapshot.selection;

  useLayoutEffect(() => {
    if (snapshot.routeQueryKey === routeSelectionQueryKey) {
      return;
    }
    const snapshotSelectionQueryKey = agentStudioSelectionQueryKey(snapshot.selection);
    if (snapshotSelectionQueryKey === routeSelectionQueryKey) {
      setSnapshot({
        routeQueryKey: routeSelectionQueryKey,
        selection: snapshot.selection,
      });
      return;
    }
    requestContextTransition(
      () => {
        setSnapshot({
          routeQueryKey: routeSelectionQueryKey,
          selection: routeSelection,
        });
      },
      () => {
        scheduleQueryUpdate(buildAgentStudioSelectionQueryUpdateFromState(snapshot.selection));
      },
    );
  }, [
    requestContextTransition,
    routeSelection,
    routeSelectionQueryKey,
    scheduleQueryUpdate,
    snapshot,
  ]);

  const selectAgentStudioSelection = useCallback<SelectAgentStudioSelection>(
    (nextSelection) => {
      requestContextTransition(() => {
        setSnapshot({
          routeQueryKey: routeSelectionQueryKey,
          selection: nextSelection,
        });
        scheduleQueryUpdate(buildAgentStudioSelectionQueryUpdateFromState(nextSelection));
      });
    },
    [requestContextTransition, routeSelectionQueryKey, scheduleQueryUpdate],
  );

  return {
    selection,
    selectAgentStudioSelection,
  };
}

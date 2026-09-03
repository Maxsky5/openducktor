import type { AgentRole } from "@openducktor/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectionState,
  agentStudioSelectionQueryKey,
  buildAgentStudioSelectionQueryUpdateFromState,
  createAgentStudioRouteSelectionState,
  type SelectAgentStudioSelection,
} from "./agent-studio-selection-state";

type UseAgentStudioSelectionStateArgs = {
  isWorkspaceRestorePending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  requestContextTransition: (
    applyTransition: () => void,
    cancelTransition?: () => void,
    options?: { force: boolean },
  ) => void;
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
  isWorkspaceRestorePending,
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
        isWorkspaceRestorePending,
        taskIdParam,
        sessionExternalIdParam,
        hasExplicitRoleParam,
        roleFromQuery,
      }),
    [
      hasExplicitRoleParam,
      isWorkspaceRestorePending,
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
  const latestTransitionStateRef = useRef({
    routeSelection,
    routeSelectionQueryKey,
    snapshot,
  });

  const selection = snapshot.selection;

  useLayoutEffect(() => {
    latestTransitionStateRef.current = {
      routeSelection,
      routeSelectionQueryKey,
      snapshot,
    };
  }, [routeSelection, routeSelectionQueryKey, snapshot]);

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
    const requestedRouteQueryKey = routeSelectionQueryKey;
    requestContextTransition(
      () => {
        const latest = latestTransitionStateRef.current;
        setSnapshot({
          routeQueryKey: latest.routeSelectionQueryKey,
          selection: latest.routeSelection,
        });
      },
      () => {
        const latest = latestTransitionStateRef.current;
        if (latest.routeSelectionQueryKey !== requestedRouteQueryKey) return;
        scheduleQueryUpdate(
          buildAgentStudioSelectionQueryUpdateFromState(latest.snapshot.selection),
        );
      },
      { force: isWorkspaceRestorePending },
    );
  }, [
    isWorkspaceRestorePending,
    requestContextTransition,
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

import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useSessionViewActive } from "@/features/session-navigation/session-view-context";
import type { AgentRole } from "@openducktor/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectionState,
  agentStudioSelectionQueryKey,
  agentStudioSelectionRouteKey,
  buildAgentStudioSelectionQueryUpdateFromState,
  createAgentStudioRouteSelectionState,
  type SelectAgentStudioSelection,
} from "./agent-studio-selection-state";

type UseAgentStudioSelectionStateArgs = {
  activeWorkspaceId: string | null;
  isWorkspaceRestorePending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  routeSessionIdentity?: AgentSessionIdentity | null;
  keepSessionlessParam?: boolean;
  isNavigationPending?: boolean;
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
  workspaceId: string | null;
  routeQueryKey: string;
  selection: AgentStudioSelectionState;
};

export type AgentStudioSelectionStateModel = {
  selection: AgentStudioSelectionState;
  isRoutePending: boolean;
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export function useAgentStudioSelectionState({
  activeWorkspaceId,
  isWorkspaceRestorePending,
  taskIdParam,
  sessionExternalIdParam,
  routeSessionIdentity = null,
  keepSessionlessParam = false,
  isNavigationPending = false,
  hasExplicitRoleParam,
  roleFromQuery,
  scheduleQueryUpdate,
  requestContextTransition,
}: UseAgentStudioSelectionStateArgs): AgentStudioSelectionStateModel {
  const isActive = useSessionViewActive();
  const routeSelection = useMemo(
    () =>
      createAgentStudioRouteSelectionState({
        isWorkspaceRestorePending,
        taskIdParam,
        sessionExternalIdParam,
        routeSessionIdentity,
        keepSessionlessParam,
        hasExplicitRoleParam,
        roleFromQuery,
      }),
    [
      hasExplicitRoleParam,
      keepSessionlessParam,
      isWorkspaceRestorePending,
      roleFromQuery,
      sessionExternalIdParam,
      routeSessionIdentity,
      taskIdParam,
    ],
  );
  const routeSelectionQueryKey = useMemo(
    () => agentStudioSelectionRouteKey(routeSelection),
    [routeSelection],
  );
  const routeHasSessionIdentity = routeSelection.sessionIdentity !== null;
  const [snapshot, setSnapshot] = useState<SelectionStateSnapshot>(() => ({
    workspaceId: activeWorkspaceId,
    routeQueryKey: routeSelectionQueryKey,
    selection: routeSelection,
  }));
  // Drop the previous workspace's selection during render so effects never pair
  // this workspace with a session directory that belongs to another one.
  let currentSnapshot = snapshot;
  if (snapshot.workspaceId !== activeWorkspaceId) {
    currentSnapshot = {
      workspaceId: activeWorkspaceId,
      routeQueryKey: routeSelectionQueryKey,
      selection: routeSelection,
    };
    setSnapshot(currentSnapshot);
  }
  const latestTransitionStateRef = useRef({
    isActive,
    routeSelection,
    routeSelectionQueryKey,
    snapshot: currentSnapshot,
  });
  const lastWorkspaceIdRef = useRef(activeWorkspaceId);

  const selection = currentSnapshot.selection;

  useLayoutEffect(() => {
    latestTransitionStateRef.current = {
      isActive,
      routeSelection,
      routeSelectionQueryKey,
      snapshot: currentSnapshot,
    };
  }, [currentSnapshot, isActive, routeSelection, routeSelectionQueryKey]);

  useLayoutEffect(() => {
    const workspaceChanged = lastWorkspaceIdRef.current !== activeWorkspaceId;
    lastWorkspaceIdRef.current = activeWorkspaceId;
    if (!workspaceChanged && currentSnapshot.routeQueryKey === routeSelectionQueryKey) return;
    if (!workspaceChanged) {
      // A route without an identity is less specific, so the same session keeps its identity.
      const snapshotSelectionQueryKey = routeHasSessionIdentity
        ? agentStudioSelectionRouteKey(currentSnapshot.selection)
        : agentStudioSelectionQueryKey(currentSnapshot.selection);
      if (
        snapshotSelectionQueryKey === routeSelectionQueryKey &&
        currentSnapshot.selection.keepSessionless === routeSelection.keepSessionless
      ) {
        setSnapshot({
          workspaceId: currentSnapshot.workspaceId,
          routeQueryKey: routeSelectionQueryKey,
          selection: currentSnapshot.selection,
        });
        return;
      }
    }
    const requestedRouteQueryKey = routeSelectionQueryKey;
    requestContextTransition(
      () => {
        const latest = latestTransitionStateRef.current;
        setSnapshot({
          workspaceId: latest.snapshot.workspaceId,
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
      // A workspace change forces the transition, because the previous workspace's
      // file preview must not survive the boundary.
      { force: workspaceChanged || isWorkspaceRestorePending },
    );
  }, [
    activeWorkspaceId,
    currentSnapshot,
    isWorkspaceRestorePending,
    requestContextTransition,
    routeHasSessionIdentity,
    routeSelection.keepSessionless,
    routeSelectionQueryKey,
    scheduleQueryUpdate,
  ]);

  const selectAgentStudioSelection = useCallback<SelectAgentStudioSelection>(
    (nextSelection) => {
      if (!latestTransitionStateRef.current.isActive) return;
      const selectedWorkspaceId = activeWorkspaceId;
      requestContextTransition(() => {
        // Drop a deferred selection when the workspace changed before the apply.
        if (
          !latestTransitionStateRef.current.isActive ||
          latestTransitionStateRef.current.snapshot.workspaceId !== selectedWorkspaceId
        ) {
          return;
        }
        scheduleQueryUpdate(buildAgentStudioSelectionQueryUpdateFromState(nextSelection));
      });
    },
    [activeWorkspaceId, requestContextTransition, scheduleQueryUpdate],
  );

  return {
    selection,
    isRoutePending: isNavigationPending || currentSnapshot.routeQueryKey !== routeSelectionQueryKey,
    selectAgentStudioSelection,
  };
}

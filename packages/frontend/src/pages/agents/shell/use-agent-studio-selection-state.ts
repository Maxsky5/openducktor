import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
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
  activeWorkspaceId: string | null;
  isWorkspaceRestorePending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  routeSessionIdentity?: AgentSessionIdentity | null;
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
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export function useAgentStudioSelectionState({
  activeWorkspaceId,
  isWorkspaceRestorePending,
  taskIdParam,
  sessionExternalIdParam,
  routeSessionIdentity = null,
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
        routeSessionIdentity,
        hasExplicitRoleParam,
        roleFromQuery,
      }),
    [
      hasExplicitRoleParam,
      isWorkspaceRestorePending,
      roleFromQuery,
      sessionExternalIdParam,
      routeSessionIdentity,
      taskIdParam,
    ],
  );
  const routeSelectionQueryKey = useMemo(() => {
    const queryKey = agentStudioSelectionQueryKey(routeSelection);
    return routeSelection.sessionIdentity
      ? `${queryKey}${agentSessionIdentityKey(routeSelection.sessionIdentity)}`
      : queryKey;
  }, [routeSelection]);
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
    routeSelection,
    routeSelectionQueryKey,
    snapshot: currentSnapshot,
  });
  const lastWorkspaceIdRef = useRef(activeWorkspaceId);

  const selection = currentSnapshot.selection;

  useLayoutEffect(() => {
    latestTransitionStateRef.current = {
      routeSelection,
      routeSelectionQueryKey,
      snapshot: currentSnapshot,
    };
  }, [currentSnapshot, routeSelection, routeSelectionQueryKey]);

  useLayoutEffect(() => {
    const workspaceChanged = lastWorkspaceIdRef.current !== activeWorkspaceId;
    lastWorkspaceIdRef.current = activeWorkspaceId;
    if (!workspaceChanged && currentSnapshot.routeQueryKey === routeSelectionQueryKey) {
      return;
    }
    if (!workspaceChanged) {
      const snapshotSelectionQueryKey = agentStudioSelectionQueryKey(currentSnapshot.selection);
      if (snapshotSelectionQueryKey === routeSelectionQueryKey) {
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
    routeSelectionQueryKey,
    scheduleQueryUpdate,
  ]);

  const selectAgentStudioSelection = useCallback<SelectAgentStudioSelection>(
    (nextSelection) => {
      const selectedWorkspaceId = activeWorkspaceId;
      requestContextTransition(() => {
        // Drop a deferred selection when the workspace changed before the apply.
        if (latestTransitionStateRef.current.snapshot.workspaceId !== selectedWorkspaceId) {
          return;
        }
        setSnapshot((current) => ({
          workspaceId: current.workspaceId,
          routeQueryKey: routeSelectionQueryKey,
          selection: nextSelection,
        }));
        scheduleQueryUpdate(buildAgentStudioSelectionQueryUpdateFromState(nextSelection));
      });
    },
    [activeWorkspaceId, requestContextTransition, routeSelectionQueryKey, scheduleQueryUpdate],
  );

  return {
    selection,
    selectAgentStudioSelection,
  };
}

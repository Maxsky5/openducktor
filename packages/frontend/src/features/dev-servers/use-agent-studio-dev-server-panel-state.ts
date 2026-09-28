import type { DevServerEvent, DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, useCallback, useEffect, useRef } from "react";
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@/lib/browser-live/constants";
import { errorMessage } from "@/lib/errors";
import { subscribeDevServerEvents } from "@/lib/host-client";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import { isSameDevServerOwner } from "@/types/dev-server-scope";
import {
  applyDevServerEventToState,
  isDevServerSubscriptionControlEvent,
} from "./use-agent-studio-dev-server-panel-helpers";
import { useAgentStudioDevServerTerminalBuffers } from "./use-agent-studio-dev-server-terminal-buffers";

type DevServerPanelLocalState = {
  liveState: DevServerGroupState | null;
  actionError: string | null;
  subscriptionError: string | null;
  subscribedScopeKey: string | null;
  transportEpoch: string | null;
};

export type DevServerPanelAction =
  | { type: "scopeReset" }
  | { type: "transportReconnected"; transportEpoch: string }
  | { type: "liveStateChanged"; state: DevServerGroupState | null }
  | {
      type: "liveStateUpdated";
      update: (current: DevServerGroupState | null) => DevServerGroupState | null;
    }
  | { type: "actionStarted" }
  | { type: "actionFailed"; error: string }
  | { type: "subscriptionFailed"; error: string }
  | { type: "eventsSynced" }
  | { type: "subscriptionReady"; scopeKey: string; transportEpoch: string };

export type TerminalBuffers = ReturnType<typeof useAgentStudioDevServerTerminalBuffers>;

export const useDevServerSubscription = ({
  clearTerminalBuffers,
  dispatchLocalState,
  owner,
  scopeKey,
  repoPath,
  requestTerminalRehydrate,
  subscriptionEnabled,
  syncStateFromEvent,
  transportEpochRef,
}: {
  clearTerminalBuffers: () => void;
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  owner: DevServerOwner | null;
  scopeKey: string | null;
  repoPath: string | null;
  requestTerminalRehydrate: () => void;
  subscriptionEnabled: boolean;
  syncStateFromEvent: (event: DevServerEvent) => void;
  transportEpochRef: RefObject<string | null>;
}): void => {
  useEffect(() => {
    if (!subscriptionEnabled || repoPath === null || owner === null || scopeKey === null) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void subscribeDevServerEvents((payload) => {
      if (cancelled) return;

      if (isDevServerSubscriptionControlEvent(payload)) {
        if (payload.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
          transportEpochRef.current = payload.transportEpoch;
          clearTerminalBuffers();
          dispatchLocalState({
            type: "transportReconnected",
            transportEpoch: payload.transportEpoch,
          });
          return;
        }
        requestTerminalRehydrate();
        return;
      }

      const event = payload;
      const eventScope = event.type === "snapshot" ? event.state : event;
      if (eventScope.repoPath !== repoPath || !isSameDevServerOwner(eventScope.owner, owner)) {
        return;
      }

      syncStateFromEvent(event);
      dispatchLocalState({ type: "eventsSynced" });
    })
      .then((subscription) => {
        if (cancelled) {
          subscription.unsubscribe();
          return;
        }

        unsubscribe = subscription.unsubscribe;
        transportEpochRef.current = subscription.transportEpoch;
        clearTerminalBuffers();
        dispatchLocalState({
          type: "subscriptionReady",
          scopeKey,
          transportEpoch: subscription.transportEpoch,
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          dispatchLocalState({ type: "subscriptionFailed", error: errorMessage(cause) });
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    clearTerminalBuffers,
    dispatchLocalState,
    owner,
    scopeKey,
    repoPath,
    requestTerminalRehydrate,
    subscriptionEnabled,
    syncStateFromEvent,
    transportEpochRef,
  ]);
};

export const useDevServerEventStateSync = ({
  applyTerminalBuffersFromEvent,
  dispatchLocalState,
  markMutationReplayObserved,
  owner,
  queryClient,
  repoPath,
  selectedScriptIdRef,
  transportEpochRef,
}: {
  applyTerminalBuffersFromEvent: TerminalBuffers["applyTerminalBuffersFromEvent"];
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  markMutationReplayObserved: TerminalBuffers["markMutationReplayObserved"];
  owner: DevServerOwner | null;
  queryClient: QueryClient;
  repoPath: string | null;
  selectedScriptIdRef: { current: string | null };
  transportEpochRef: RefObject<string | null>;
}) =>
  useCallback(
    (event: DevServerEvent): void => {
      const activeTransportEpoch = transportEpochRef.current;
      if (!repoPath || !owner || !activeTransportEpoch) return;
      if (!applyTerminalBuffersFromEvent(event, selectedScriptIdRef.current)) return;
      markMutationReplayObserved(event);

      if (event.type !== "terminal_chunk") {
        const queryKey = devServerQueryKeys.state(repoPath, owner, activeTransportEpoch);
        const cachedState = queryClient.getQueryData<DevServerGroupState>(queryKey) ?? null;
        dispatchLocalState({
          type: "liveStateUpdated",
          update: (current) => {
            const scopedCurrent =
              current && current.repoPath === repoPath && isSameDevServerOwner(current.owner, owner)
                ? current
                : null;
            const nextState = applyDevServerEventToState(cachedState ?? scopedCurrent, event);
            if (nextState) queryClient.setQueryData(queryKey, nextState);
            return nextState;
          },
        });
      }
    },
    [
      applyTerminalBuffersFromEvent,
      dispatchLocalState,
      markMutationReplayObserved,
      owner,
      queryClient,
      repoPath,
      selectedScriptIdRef,
      transportEpochRef,
    ],
  );

export const useDevServerQueryHydration = ({
  clearTerminalBuffers,
  dispatchLocalState,
  effectiveSelectedScriptId,
  effectiveState,
  hydrateTerminalBuffersFromState,
  scopeKey,
  queryData,
  queryEnabled,
  resetSelectedScript,
  subscriptionEnabled,
  transportEpochRef,
}: {
  clearTerminalBuffers: TerminalBuffers["clearTerminalBuffers"];
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  effectiveSelectedScriptId: string | null;
  effectiveState: DevServerGroupState | null;
  hydrateTerminalBuffersFromState: TerminalBuffers["hydrateTerminalBuffersFromState"];
  scopeKey: string | null;
  queryData: DevServerGroupState | null;
  queryEnabled: boolean;
  resetSelectedScript: () => void;
  subscriptionEnabled: boolean;
  transportEpochRef: RefObject<string | null>;
}): void => {
  const previousScopeKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const scopeChanged = previousScopeKeyRef.current !== scopeKey;
    previousScopeKeyRef.current = scopeKey;

    if (scopeChanged) {
      transportEpochRef.current = null;
      resetSelectedScript();
      dispatchLocalState({ type: "scopeReset" });
    }

    if (!subscriptionEnabled) {
      transportEpochRef.current = null;
      clearTerminalBuffers();
      resetSelectedScript();
      dispatchLocalState({ type: "scopeReset" });
      return;
    }

    if (
      queryEnabled &&
      queryData &&
      (!effectiveState || queryData.revision >= effectiveState.revision)
    ) {
      if (hydrateTerminalBuffersFromState(queryData, effectiveSelectedScriptId)) {
        dispatchLocalState({ type: "liveStateChanged", state: queryData });
      }
    }
  }, [
    clearTerminalBuffers,
    dispatchLocalState,
    effectiveSelectedScriptId,
    effectiveState,
    hydrateTerminalBuffersFromState,
    scopeKey,
    queryData,
    queryEnabled,
    resetSelectedScript,
    subscriptionEnabled,
    transportEpochRef,
  ]);
};

export const devServerPanelReducer = (
  state: DevServerPanelLocalState,
  action: DevServerPanelAction,
): DevServerPanelLocalState => {
  switch (action.type) {
    case "scopeReset":
      return {
        ...state,
        liveState: null,
        actionError: null,
        subscriptionError: null,
        subscribedScopeKey: null,
        transportEpoch: null,
      };
    case "transportReconnected":
      return {
        ...state,
        liveState: null,
        subscriptionError: null,
        transportEpoch: action.transportEpoch,
      };
    case "liveStateChanged":
      return { ...state, liveState: action.state };
    case "liveStateUpdated":
      return { ...state, liveState: action.update(state.liveState) };
    case "actionStarted":
      return { ...state, actionError: null };
    case "actionFailed":
      return { ...state, actionError: action.error };
    case "subscriptionFailed":
      return { ...state, subscriptionError: action.error };
    case "eventsSynced":
      return { ...state, actionError: null, subscriptionError: null };
    case "subscriptionReady":
      return {
        ...state,
        subscriptionError: null,
        subscribedScopeKey: action.scopeKey,
        transportEpoch: action.transportEpoch,
      };
  }
};

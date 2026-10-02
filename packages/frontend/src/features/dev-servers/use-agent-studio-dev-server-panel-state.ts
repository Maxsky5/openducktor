import type { DevServerEvent, DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, useCallback, useEffect } from "react";
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@/lib/browser-live/constants";
import { errorMessage } from "@/lib/errors";
import { subscribeDevServerEvents } from "@/lib/host-client";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import { isSameDevServerOwner } from "@/types/dev-server-scope";
import {
  applyDevServerEventToState,
  isDevServerSubscriptionControlEvent,
} from "./use-agent-studio-dev-server-panel-helpers";

type DevServerPanelLocalState = {
  actionError: string | null;
  subscriptionError: string | null;
  subscribedScopeKey: string | null;
  transportEpoch: string | null;
};

export type DevServerPanelAction =
  | { type: "scopeReset" }
  | { type: "transportReconnected"; transportEpoch: string }
  | { type: "actionStarted" }
  | { type: "retryStarted" }
  | { type: "actionFailed"; error: string }
  | { type: "subscriptionFailed"; error: string }
  | { type: "eventsSynced" }
  | { type: "subscriptionReady"; scopeKey: string; transportEpoch: string };

export const useDevServerSubscription = ({
  dispatchLocalState,
  owner,
  scopeKey,
  repoPath,
  refreshMetadata,
  retryCount,
  subscriptionEnabled,
  syncStateFromEvent,
  transportEpochRef,
}: {
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  owner: DevServerOwner | null;
  scopeKey: string | null;
  repoPath: string | null;
  refreshMetadata: () => void;
  retryCount: number;
  subscriptionEnabled: boolean;
  syncStateFromEvent: (event: DevServerEvent) => void;
  transportEpochRef: RefObject<string | null>;
}): void => {
  useEffect(() => {
    if (!subscriptionEnabled || repoPath === null || owner === null || scopeKey === null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void subscribeDevServerEvents((payload) => {
      if (cancelled) return;
      if (isDevServerSubscriptionControlEvent(payload)) {
        if (payload.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
          transportEpochRef.current = payload.transportEpoch;
          dispatchLocalState({
            type: "transportReconnected",
            transportEpoch: payload.transportEpoch,
          });
        } else refreshMetadata();
        return;
      }
      const eventScope = payload.type === "snapshot" ? payload.state : payload;
      if (eventScope.repoPath !== repoPath || !isSameDevServerOwner(eventScope.owner, owner))
        return;
      syncStateFromEvent(payload);
      dispatchLocalState({ type: "eventsSynced" });
    })
      .then((subscription) => {
        if (cancelled) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        transportEpochRef.current = subscription.transportEpoch;
        dispatchLocalState({
          type: "subscriptionReady",
          scopeKey,
          transportEpoch: subscription.transportEpoch,
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          dispatchLocalState({ type: "subscriptionFailed", error: errorMessage(cause) });
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    dispatchLocalState,
    owner,
    scopeKey,
    repoPath,
    refreshMetadata,
    retryCount,
    subscriptionEnabled,
    syncStateFromEvent,
    transportEpochRef,
  ]);
};

export const useDevServerEventStateSync = ({
  owner,
  queryClient,
  repoPath,
  transportEpochRef,
}: {
  owner: DevServerOwner | null;
  queryClient: QueryClient;
  repoPath: string | null;
  transportEpochRef: RefObject<string | null>;
}) =>
  useCallback(
    (event: DevServerEvent): void => {
      const epoch = transportEpochRef.current;
      if (!repoPath || !owner || !epoch) return;
      const queryKey = devServerQueryKeys.state(repoPath, owner, epoch);
      queryClient.setQueryData<DevServerGroupState>(
        queryKey,
        (current) => applyDevServerEventToState(current ?? null, event) ?? undefined,
      );
    },
    [owner, queryClient, repoPath, transportEpochRef],
  );

export const useDevServerScopeReset = ({
  dispatchLocalState,
  scopeKey,
  subscriptionEnabled,
  transportEpochRef,
}: {
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  scopeKey: string | null;
  subscriptionEnabled: boolean;
  transportEpochRef: RefObject<string | null>;
}): void => {
  useEffect(() => {
    transportEpochRef.current = null;
    dispatchLocalState({ type: "scopeReset" });
  }, [dispatchLocalState, scopeKey, subscriptionEnabled, transportEpochRef]);
};

export const devServerPanelReducer = (
  state: DevServerPanelLocalState,
  action: DevServerPanelAction,
): DevServerPanelLocalState => {
  switch (action.type) {
    case "scopeReset":
      return {
        ...state,
        actionError: null,
        subscriptionError: null,
        subscribedScopeKey: null,
        transportEpoch: null,
      };
    case "transportReconnected":
      return {
        ...state,
        subscriptionError: null,
        transportEpoch: action.transportEpoch,
      };
    case "actionStarted":
      return { ...state, actionError: null };
    case "retryStarted":
      return { ...state, actionError: null, subscriptionError: null };
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

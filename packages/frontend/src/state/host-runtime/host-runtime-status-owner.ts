import type { HostRuntimeSnapshot, HostRuntimeStatus, RuntimeKind } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@/lib/browser-live/constants";
import { errorMessage } from "@/lib/errors";
import type { RuntimeChangeListener } from "@/lib/shell-bridge";
import {
  applyHostStatusEvent,
  hostRuntimeStatusQueryKeys,
  hostRuntimeStatusQueryOptions,
} from "@/state/queries/host-runtime-status";
import { invalidateRuntimeKindQueries } from "@/state/queries/runtime-query-invalidation";
import type { HostStatusSnapshot } from "@/types/diagnostics";
import type { HostRuntimeEventListener, HostRuntimeEvents } from "@/types/state-slices";

export type HostRuntimeStatusOwnerPorts = {
  subscribeRuntimeChanges: (listener: RuntimeChangeListener) => Promise<() => void>;
  runtimeStatus: () => Promise<HostRuntimeSnapshot>;
};

export type HostRuntimeStatusConnection = {
  /** Live runtime updates are unavailable. Cached state is not current. */
  streamError: string | null;
  /** A baseline read succeeded after the last subscription, reconnect, or host change. */
  hasBaseline: boolean;
  isRefreshing: boolean;
};

export type RuntimeGenerationChangeHandler = (
  runtimeKind: RuntimeKind,
  status: HostRuntimeStatus,
) => void;

/** Owns the one host runtime event subscription. It shares each event and the stream health. */
export type HostRuntimeStatusOwner = HostRuntimeEvents & {
  /** Subscribes to runtime changes, then reads the baseline. */
  start: () => void;
  stop: () => void;
  /** Reads a new baseline. Subscribes again first when live updates failed. */
  refresh: () => Promise<void>;
  getConnection: () => HostRuntimeStatusConnection;
  subscribeConnection: (listener: () => void) => () => void;
};

type ObservedGeneration = { runtimeId: string | null; isReady: boolean };

const invalidateForGeneration =
  (queryClient: QueryClient): RuntimeGenerationChangeHandler =>
  (runtimeKind, status) => {
    void invalidateRuntimeKindQueries(
      queryClient,
      runtimeKind,
      status.state === "ready" ? "ready" : "stopped",
    );
  };

export const createHostRuntimeStatusOwner = ({
  queryClient,
  ports,
  onRuntimeGenerationChange = invalidateForGeneration(queryClient),
}: {
  queryClient: QueryClient;
  ports: HostRuntimeStatusOwnerPorts;
  onRuntimeGenerationChange?: RuntimeGenerationChangeHandler;
}): HostRuntimeStatusOwner => {
  const options = hostRuntimeStatusQueryOptions(ports.runtimeStatus);
  const connectionListeners = new Set<() => void>();
  const eventListeners = new Set<HostRuntimeEventListener>();
  const observedGenerations = new Map<RuntimeKind, ObservedGeneration>();
  let connection: HostRuntimeStatusConnection = {
    streamError: null,
    hasBaseline: false,
    isRefreshing: false,
  };
  // Each start opens a new session. Late results from an earlier session are ignored.
  let session = 0;
  let isActive = false;
  let unsubscribe: (() => void) | null = null;
  let subscription: Promise<void> | null = null;
  let observedHostInstanceId: string | null = null;
  // Each baseline read replaces the earlier one. Only the latest read can set the baseline.
  let baselineRead = 0;
  // Each stream failure or recovery starts a new epoch.
  let streamEpoch = 0;

  const updateConnection = (patch: Partial<HostRuntimeStatusConnection>): void => {
    connection = { ...connection, ...patch };
    for (const listener of connectionListeners) listener();
  };

  // Records a stream failure or recovery, then tells the event listeners.
  const changeStream = (
    streamError: string | null,
    patch: Partial<HostRuntimeStatusConnection> = {},
  ): void => {
    streamEpoch += 1;
    updateConnection({ ...patch, streamError });
    for (const listener of eventListeners) listener.onStreamChange();
  };

  // Reports each kind whose runtime generation or readiness changed since the last observation.
  const observeGenerations = (): void => {
    const snapshot = queryClient.getQueryData<HostStatusSnapshot>(
      hostRuntimeStatusQueryKeys.snapshot,
    );
    for (const status of snapshot?.runtimes ?? []) {
      const next = { runtimeId: status.runtimeId, isReady: status.state === "ready" };
      const previous = observedGenerations.get(status.kind);
      observedGenerations.set(status.kind, next);
      if (
        previous !== undefined &&
        (previous.runtimeId !== next.runtimeId || previous.isReady !== next.isReady)
      ) {
        onRuntimeGenerationChange(status.kind, status);
      }
    }
  };

  // An explicit refresh ends when the latest baseline read settles, not when its own read does.
  const settleBaseline = (hasBaseline: boolean): void => {
    updateConnection({ hasBaseline, isRefreshing: false });
  };

  const readBaseline = async (readSession: number): Promise<void> => {
    if (readSession !== session) return;
    baselineRead += 1;
    const read = baselineRead;
    const isLatest = () => readSession === session && read === baselineRead;
    // A baseline must start after the current subscription or reconnect.
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    try {
      const snapshot = await queryClient.fetchQuery({ ...options, staleTime: 0 });
      // A canceled read can resolve with cached data. It is not the current baseline.
      if (!isLatest()) return;
      observedHostInstanceId = snapshot.hostInstanceId;
      observeGenerations();
      settleBaseline(true);
    } catch {
      if (!isLatest()) return;
      // The query keeps this failure next to the earlier data. That data is not current.
      settleBaseline(false);
    }
  };

  const createListener =
    (listenerSession: number): RuntimeChangeListener =>
    (event) => {
      if (listenerSession !== session) return;
      if ("__openducktorBrowserLive" in event) {
        if (event.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
          changeStream(null, { hasBaseline: false });
          void readBaseline(listenerSession);
          return;
        }
        changeStream(event.message ?? "Runtime updates are unavailable.", { hasBaseline: false });
        return;
      }
      // A runtime or MCP bridge change updates the cache. Impact changes concern open reviews only.
      if (event.type === "runtime_changed" || event.type === "mcp_bridge_changed") {
        queryClient.setQueryData<HostStatusSnapshot>(options.queryKey, (current) =>
          applyHostStatusEvent(current, event),
        );
        observeGenerations();
        if (observedHostInstanceId !== null && observedHostInstanceId !== event.hostInstanceId) {
          // A new host instance replaced the cache with one entry. Read its full state.
          observedHostInstanceId = event.hostInstanceId;
          updateConnection({ hasBaseline: false });
          void readBaseline(listenerSession);
        }
      }
      for (const listener of eventListeners) listener.onEvent(event);
    };

  const subscribe = (): Promise<void> => {
    unsubscribe?.();
    unsubscribe = null;
    const subscribeSession = session;
    // The new subscription owns the stream state. A connection failure that the transport
    // reports while it subscribes must stay visible, so success does not clear it.
    const isRecovering = connection.streamError !== null;
    if (isRecovering) {
      // A new epoch prevents an earlier read from clearing the failure for event listeners.
      streamEpoch += 1;
      // The cache missed events while the stream failed. It is current again only after the
      // baseline read that follows this subscription, as after a reconnect.
      updateConnection({ streamError: null, hasBaseline: false });
    }
    const subscribeEpoch = streamEpoch;
    subscription = ports.subscribeRuntimeChanges(createListener(subscribeSession)).then(
      (stop) => {
        if (subscribeSession !== session) {
          stop();
          return;
        }
        unsubscribe = stop;
        // Event listeners read again only when the new subscription is ready.
        if (isRecovering && streamEpoch === subscribeEpoch) changeStream(null);
      },
      (cause: unknown) => {
        if (subscribeSession !== session) return;
        changeStream(errorMessage(cause));
      },
    );
    return subscription;
  };

  return {
    start: () => {
      if (isActive) return;
      isActive = true;
      session += 1;
      const startSession = session;
      // Subscribe before the baseline so no change between them is lost.
      void subscribe().then(() => readBaseline(startSession));
    },
    stop: () => {
      isActive = false;
      session += 1;
      unsubscribe?.();
      unsubscribe = null;
      subscription = null;
      if (connection.isRefreshing) updateConnection({ isRefreshing: false });
    },
    refresh: async () => {
      if (!isActive) return;
      const refreshSession = session;
      updateConnection({ isRefreshing: true });
      if (subscription === null || connection.streamError !== null) {
        await subscribe();
      } else {
        await subscription;
      }
      await readBaseline(refreshSession);
    },
    getConnection: () => connection,
    getStreamHealth: () => ({ error: connection.streamError, epoch: streamEpoch }),
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    subscribeConnection: (listener) => {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
  };
};

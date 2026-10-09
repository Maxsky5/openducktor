import type { HostRuntimeSnapshot, HostRuntimeStatus, RuntimeKind } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@/lib/browser-live/constants";
import { errorMessage } from "@/lib/errors";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import type { RuntimeChangeListener } from "@/lib/shell-bridge";
import {
  applyHostStatusEvent,
  hostRuntimeStatusQueryKeys,
  hostRuntimeStatusQueryOptions,
} from "@/state/queries/host-runtime-status";
import { invalidateRuntimeKindQueries } from "@/state/queries/runtime-query-invalidation";
import type { HostStatusSnapshot } from "@/types/diagnostics";
import type { HostRuntimeEventListener, HostRuntimeEvents } from "@/types/state-slices";
import { withRuntimeStatusTimeout } from "./host-runtime-status-timeout";

export type HostRuntimeStatusOwnerPorts = {
  subscribeRuntimeChanges: (listener: RuntimeChangeListener) => Promise<() => void>;
  runtimeStatus: () => Promise<HostRuntimeSnapshot>;
};

export type HostRuntimeStatusConnection = {
  /** Live runtime updates are unavailable. Cached state is not current. */
  streamError: string | null;
  /** Only a full read clears this error. Live row updates can clear the query error. */
  readError: string | null;
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

export const createHostRuntimeStatusOwner = ({
  queryClient,
  ports,
  scheduleTask: scheduler = scheduleTask,
  onRuntimeGenerationChange = invalidateForGeneration(queryClient),
}: {
  queryClient: QueryClient;
  ports: HostRuntimeStatusOwnerPorts;
  scheduleTask?: ScheduleTask;
  onRuntimeGenerationChange?: RuntimeGenerationChangeHandler;
}): HostRuntimeStatusOwner => {
  const options = hostRuntimeStatusQueryOptions(ports.runtimeStatus, scheduler);
  const connectionListeners = new Set<() => void>();
  const eventListeners = new Set<HostRuntimeEventListener>();
  const observedGenerations = new Map<RuntimeKind, ObservedGeneration>();
  let connection: HostRuntimeStatusConnection = {
    streamError: null,
    readError: null,
    hasBaseline: false,
    isRefreshing: false,
  };
  // Each start opens a new session. Late results from an earlier session are ignored.
  let session = 0;
  let isActive = false;
  let unsubscribe: (() => void) | null = null;
  let subscription: Promise<void> | null = null;
  let streamController: AbortController | null = null;
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
  const settleBaseline = (readError: string | null): void => {
    updateConnection({ hasBaseline: readError === null, readError, isRefreshing: false });
  };

  const readBaseline = async (readSession: number): Promise<void> => {
    if (readSession !== session) return;
    baselineRead += 1;
    const read = baselineRead;
    const isLatest = () => readSession === session && read === baselineRead;
    // A baseline must start after the current subscription or reconnect.
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    if (!isLatest()) return;
    try {
      const snapshot = await queryClient.fetchQuery({ ...options, staleTime: 0 });
      // A canceled read can resolve with cached data. It is not the current baseline.
      if (!isLatest()) return;
      observedHostInstanceId = snapshot.hostInstanceId;
      observeGenerations();
      settleBaseline(null);
    } catch (cause) {
      if (!isLatest()) return;
      settleBaseline(errorMessage(cause));
    }
  };

  const createListener =
    (listenerSession: number, signal: AbortSignal): RuntimeChangeListener =>
    (event) => {
      if (listenerSession !== session || signal.aborted) return;
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
    streamController?.abort();
    unsubscribe?.();
    unsubscribe = null;
    const subscribeSession = session;
    const controller = new AbortController();
    streamController = controller;
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
    subscription = withRuntimeStatusTimeout(
      () =>
        ports
          .subscribeRuntimeChanges(createListener(subscribeSession, controller.signal))
          .then((stop) => {
            if (subscribeSession !== session || controller.signal.aborted) {
              stop();
              return;
            }
            // Keep cleanup even when registration and the deadline finish together.
            unsubscribe = stop;
          }),
      "subscribing to runtime changes",
      controller.signal,
      scheduler,
    ).then(
      () => {
        if (subscribeSession !== session || controller.signal.aborted) return;
        // Event listeners read again only when the new subscription is ready.
        if (isRecovering && streamEpoch === subscribeEpoch) changeStream(null);
      },
      (cause: unknown) => {
        if (subscribeSession !== session || controller.signal.aborted) return;
        controller.abort();
        unsubscribe?.();
        unsubscribe = null;
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
      streamController?.abort();
      streamController = null;
      unsubscribe?.();
      unsubscribe = null;
      subscription = null;
      void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
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

const invalidateForGeneration =
  (queryClient: QueryClient): RuntimeGenerationChangeHandler =>
  (runtimeKind, status) => {
    void invalidateRuntimeKindQueries(
      queryClient,
      runtimeKind,
      status.state === "ready" ? "ready" : "stopped",
    );
  };

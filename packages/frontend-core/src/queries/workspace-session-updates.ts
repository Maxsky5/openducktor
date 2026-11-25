import type { QueryClient } from "@tanstack/react-query";
import { connectionOf } from "../connection/client-connection";
import {
  HOST_UNREACHABLE_FAILURE,
  type HostFeedbackFailure,
  toHostFeedbackFailure,
} from "../lib/host-failure";
import { CONNECTION_STREAM_WARNING_EVENT_KIND } from "../recovery/connection-control-events";
import { updateWorkspaceSessionQueries, workspaceSessionQueryKeys } from "./workspace-sessions";

type StatusListener = (failure: HostFeedbackFailure | null) => void;
type Subscription = {
  listeners: Set<StatusListener>;
  error: HostFeedbackFailure | null;
  closed: boolean;
  starting: boolean;
  failed: boolean;
  /** The stream reported a lost connection. Only its reconnect clears it. */
  streamWarning: boolean;
  stop?: () => void;
};

const subscriptions = new WeakMap<QueryClient, Subscription>();

/** One ordered metadata subscription updates each shared query cache. */
export const observeWorkspaceSessionRecords = (
  queryClient: QueryClient,
  onStatus: StatusListener,
): (() => void) => {
  let subscription = subscriptions.get(queryClient);
  if (!subscription) {
    subscription = {
      listeners: new Set(),
      error: null,
      closed: false,
      starting: false,
      failed: true,
      streamWarning: false,
    };
    subscriptions.set(queryClient, subscription);
  }
  const current = subscription;
  current.listeners.add(onStatus);
  onStatus(current.error);
  const report = (error: HostFeedbackFailure | null): void => {
    if (current.closed) return;
    current.error = error;
    for (const listener of current.listeners) listener(error);
  };
  if (current.failed && !current.starting) {
    current.starting = true;
    current.failed = false;
    void connectionOf(queryClient)
      .host.subscribeWorkspaceSessionUpdates((event) => {
        if (current.closed) return;
        if ("__openducktorConnectionControl" in event) {
          if (event.kind === CONNECTION_STREAM_WARNING_EVENT_KIND) {
            // The shared stream reports only a lost host connection.
            current.streamWarning = true;
            report(HOST_UNREACHABLE_FAILURE);
          } else {
            current.streamWarning = false;
            report(null);
            if (event.missedEvents) {
              void queryClient.invalidateQueries({
                queryKey: workspaceSessionQueryKeys.all,
                refetchType: "all",
              });
              void queryClient.invalidateQueries({
                queryKey: ["workspace-session-archive-preview"],
              });
            }
          }
          return;
        }
        report(null);
        updateWorkspaceSessionQueries(queryClient, event.workspaceId, event.session);
      })
      .then((stop) => {
        current.starting = false;
        if (current.closed) stop();
        else {
          current.stop = stop;
          // A warning that arrived while subscribing stays until the reconnect.
          if (!current.streamWarning) report(null);
        }
      })
      .catch((cause: unknown) => {
        current.starting = false;
        current.failed = true;
        report(toHostFeedbackFailure(cause));
      });
  }
  return () => {
    current.listeners.delete(onStatus);
    if (current.listeners.size > 0) return;
    current.closed = true;
    current.stop?.();
    subscriptions.delete(queryClient);
  };
};

import type { QueryClient } from "@tanstack/react-query";
import { subscribeWorkspaceSessionUpdates } from "@/lib/host-client";
import { errorMessage } from "@/lib/errors";
import { BROWSER_LIVE_STREAM_WARNING_EVENT_KIND } from "@/lib/browser-live/constants";
import { updateWorkspaceSessionQueries, workspaceSessionQueryKeys } from "./workspace-sessions";

type StatusListener = (error: string | null) => void;
type Subscription = {
  listeners: Set<StatusListener>;
  error: string | null;
  closed: boolean;
  starting: boolean;
  failed: boolean;
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
    };
    subscriptions.set(queryClient, subscription);
  }
  const current = subscription;
  current.listeners.add(onStatus);
  onStatus(current.error);
  const report = (error: string | null): void => {
    if (current.closed) return;
    current.error = error;
    for (const listener of current.listeners) listener(error);
  };
  if (current.failed && !current.starting) {
    current.starting = true;
    current.failed = false;
    void subscribeWorkspaceSessionUpdates((event) => {
      if (current.closed) return;
      if ("__openducktorBrowserLive" in event) {
        if (event.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND) {
          report(event.message ?? "Workspace Session updates are unavailable.");
        } else {
          report(null);
          if (event.missedEvents) {
            void queryClient.invalidateQueries({
              queryKey: workspaceSessionQueryKeys.all,
              refetchType: "all",
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
          report(null);
        }
      })
      .catch((cause: unknown) => {
        current.starting = false;
        current.failed = true;
        report(errorMessage(cause));
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

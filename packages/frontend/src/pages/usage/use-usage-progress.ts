import type { UsageIndexProgress } from "@openducktor/contracts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useEffect, useState } from "react";

/** The latest progress of the usage index, and when this page saw its first event. */
export type UsageProgressState = { progress: UsageIndexProgress; seenSinceMs: number };

/**
 * The parse progress of the host's usage index while `active`. The host publishes it only while
 * a read parses new history, so a fast read never has progress.
 */
export const useUsageProgress = (active: boolean): UsageProgressState | null => {
  const host = useHostConnection();
  const [state, setState] = useState<UsageProgressState | null>(null);
  useEffect(() => {
    if (!active) return;
    let closed = false;
    let stop: (() => void) | null = null;
    void host
      .subscribeUsageProgress((event) => {
        if (closed || "__openducktorConnectionControl" in event) return;
        setState((current) => ({
          progress: event,
          seenSinceMs: current?.seenSinceMs ?? Date.now(),
        }));
      })
      .then((unsubscribe) => {
        if (closed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((cause: unknown) => console.error("Usage progress subscription failed", cause));
    return () => {
      closed = true;
      stop?.();
      setState(null);
    };
  }, [active, host]);
  return active ? state : null;
};

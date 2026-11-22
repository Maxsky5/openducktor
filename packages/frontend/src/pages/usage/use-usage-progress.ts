import type { UsageIndexProgress } from "@openducktor/contracts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useEffect, useState } from "react";

/** The latest progress of the usage index, and when this page saw its first event. */
export type UsageProgressState = { progress: UsageIndexProgress; seenSinceMs: number };

/** A read that ends sooner shows no progress, so a short parse never flashes it. */
const SHOW_AFTER_MS = 1_500;

/**
 * The parse progress of the host's usage index while `active`, once the read has parsed for
 * `SHOW_AFTER_MS`. The host publishes it only while a read parses new history.
 */
export const useUsageProgress = (active: boolean): UsageProgressState | null => {
  const host = useHostConnection();
  const [state, setState] = useState<UsageProgressState | null>(null);
  const [visible, setVisible] = useState(false);
  const seenSinceMs = state?.seenSinceMs ?? null;
  useEffect(() => {
    if (seenSinceMs === null) return;
    const timer = setTimeout(
      () => setVisible(true),
      Math.max(0, seenSinceMs + SHOW_AFTER_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [seenSinceMs]);
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
      setVisible(false);
    };
  }, [active, host]);
  return active && visible ? state : null;
};

import type { UsageIndexProgress } from "@openducktor/contracts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { isConnectionControlEvent } from "@openducktor/frontend-core/recovery/connection-control-events";
import { useEffect, useState } from "react";
import {
  type Carried,
  carryProgress,
  isSummarizing,
  overallFraction,
  shownProgress,
} from "./usage-progress";

/**
 * The progress that the page shows: the progress of each runtime, the overall share, which never
 * goes back, whether the read builds the daily totals, and when the page saw its first event.
 */
export type UsageProgressState = {
  progress: UsageIndexProgress;
  share: number;
  summarizing: boolean;
  seenSinceMs: number;
};

/** A later read that ends sooner shows no progress, so a short parse never flashes it. */
const SHOW_AFTER_MS = 1_500;

/**
 * The parse progress of the host's usage index while `active`. The host publishes it only while
 * a read parses new history. A first read shows at once: it takes a while, and the page has
 * nothing else to show. A later read shows once it has parsed for `SHOW_AFTER_MS`.
 */
export const useUsageProgress = (active: boolean): UsageProgressState | null => {
  const host = useHostConnection();
  const [state, setState] = useState<
    (UsageProgressState & { carried: Carried; first: boolean }) | null
  >(null);
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
        if (closed || isConnectionControlEvent(event)) return;
        setState((current) => {
          const carried = carryProgress(current?.carried ?? null, event);
          const progress = shownProgress(carried);
          // The weights of the share settle once every runtime knows its sessions; the share
          // that the page showed stays.
          const share = Math.max(current?.share ?? 0, overallFraction(progress));
          return {
            carried,
            progress,
            share,
            summarizing: isSummarizing(progress),
            seenSinceMs: current?.seenSinceMs ?? Date.now(),
            first: (current?.first ?? false) || event.first,
          };
        });
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
  if (!active || !state || !(visible || state.first)) return null;
  return {
    progress: state.progress,
    share: state.share,
    summarizing: state.summarizing,
    seenSinceMs: state.seenSinceMs,
  };
};

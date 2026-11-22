import type { RuntimeKind, UsageIndexProgress } from "@openducktor/contracts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useEffect, useState } from "react";

/**
 * The progress that the page shows: the progress of each runtime, the overall share, which never
 * goes back, and when the page saw its first event.
 */
export type UsageProgressState = {
  progress: UsageIndexProgress;
  share: number;
  seenSinceMs: number;
};

/** What earlier reads finished of one runtime: its sessions and its share of the parse work. */
type Earlier = { sessions: number; progress: number };

/** The last event of the current read, and what earlier reads finished. */
type Carried = { last: UsageIndexProgress; earlier: ReadonlyMap<RuntimeKind, Earlier> };

/**
 * Adds an event. A read that follows a canceled one, such as the read of a range that the user
 * picked during a first read, parses only what the canceled read did not start: the sessions and
 * the share that the earlier read finished stay counted.
 */
export const carryProgress = (carried: Carried | null, event: UsageIndexProgress): Carried => {
  if (!carried || carried.last.startedAt === event.startedAt)
    return { last: event, earlier: carried?.earlier ?? new Map() };
  const earlier = new Map<RuntimeKind, Earlier>();
  for (const runtime of new Set([
    ...carried.earlier.keys(),
    ...carried.last.runtimes.map((entry) => entry.runtime),
  ])) {
    const shown = shownProgress(carried).runtimes.find((entry) => entry.runtime === runtime);
    if (shown) earlier.set(runtime, { sessions: shown.sessions.done, progress: shown.progress });
  }
  return { last: event, earlier };
};

/** The progress of all reads so far: the current read on top of what earlier reads finished. */
export const shownProgress = ({ last, earlier }: Carried): UsageIndexProgress => {
  const runtimes = last.runtimes.map((entry) => {
    const before = earlier.get(entry.runtime);
    if (!before) return entry;
    const { done, total } = entry.sessions;
    // A runtime that an earlier read finished stays done: a later read only adds what changed
    // during that read.
    if (before.progress === 1)
      return {
        ...entry,
        progress: 1,
        done: true,
        sessions: { done: before.sessions + done, total: before.sessions + (total ?? done) },
      };
    return {
      ...entry,
      progress: before.progress + (1 - before.progress) * entry.progress,
      sessions: {
        done: before.sessions + done,
        total: total === null ? null : before.sessions + total,
      },
    };
  });
  // A runtime that the current read does not parse has nothing left to read.
  for (const [runtime, before] of earlier)
    if (!last.runtimes.some((entry) => entry.runtime === runtime))
      runtimes.push({
        runtime,
        progress: 1,
        done: true,
        sessions: { done: before.sessions, total: before.sessions },
      });
  return { ...last, runtimes };
};

/** The parse takes about 80% of a first read; the daily totals take the rest. */
const PARSE_WEIGHT = 0.8;

/**
 * The share of the whole read: the parse, then the daily totals. In the parse, each runtime weighs
 * as much as its sessions to read, so a runtime with few sessions cannot fill the ring while a
 * large one still reads. Runtimes count alike until every runtime knows its sessions.
 */
export const overallFraction = (progress: UsageIndexProgress): number => {
  const { runtimes } = progress;
  const known = runtimes.every((runtime) => (runtime.sessions.total ?? 0) > 0);
  let done = 0;
  let total = 0;
  for (const runtime of runtimes) {
    const weight = known ? (runtime.sessions.total ?? 1) : 1;
    done += weight * runtime.progress;
    total += weight;
  }
  // Before the history search ends, no runtime has work yet.
  const parsed = total === 0 ? 0 : done / total;
  return PARSE_WEIGHT * parsed + (1 - PARSE_WEIGHT) * progress.summarized;
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
        if (closed || "__openducktorConnectionControl" in event) return;
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
  return { progress: state.progress, share: state.share, seenSinceMs: state.seenSinceMs };
};

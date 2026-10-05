import type { RuntimeKind, RuntimeLifecycleImpact } from "@openducktor/contracts";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useHostRuntimeStatusContext } from "@/state/app-state-contexts";
import type { HostRuntimeEvents } from "@/types/state-slices";

export type RuntimeImpactState = {
  impact: RuntimeLifecycleImpact | null;
  /** A read is in progress. The shown impact may be old. */
  isLoading: boolean;
  /** The last read failed, or live updates stopped. The shown impact is not current. */
  error: string | null;
};

const INITIAL_STATE: RuntimeImpactState = { impact: null, isLoading: true, error: null };

export type RuntimeImpactWatch = {
  /** Shows an impact that the host returned with a rejected confirmation. */
  replace: (impact: RuntimeLifecycleImpact) => void;
  /**
   * Stops reads and state changes while the reviewed action runs. The action changes the runtime
   * and its sessions, so reads during it only show passing states.
   */
  pause: () => void;
  /** Shows the latest state again, and reads again when a change arrived during the pause. */
  resume: () => void;
  close: () => void;
};

/**
 * Keeps an open lifecycle review current. It listens to the shared host runtime events, then
 * reads the impact. It reads again when a live session or the runtime of a reviewed kind changes,
 * and after live updates recover. It never polls. The host still checks the confirmation.
 */
export const watchRuntimeImpact = ({
  kinds,
  readImpact,
  events,
  onState,
}: {
  /** Returns the kinds under review. */
  kinds: () => ReadonlyArray<RuntimeKind>;
  readImpact: () => Promise<RuntimeLifecycleImpact>;
  events: HostRuntimeEvents;
  onState: (state: RuntimeImpactState) => void;
}): RuntimeImpactWatch => {
  let closed = false;
  let paused = false;
  let changedWhilePaused = false;
  let reading = false;
  let readAgain = false;
  let impact: RuntimeLifecycleImpact | null = null;
  let isLoading = true;
  let readError: string | null = null;
  // A stream failure blocks the review, also after recovery. Only a read that starts after the
  // recovery, with no later stream change, clears it. A review that opens during a failure
  // starts blocked.
  let streamFailure = events.getStreamHealth().error;

  const publish = (): void => {
    if (closed || paused) return;
    onState({ impact, isLoading, error: streamFailure ?? readError });
  };

  // One read at a time. A change during a read starts one more read after it.
  const read = async (): Promise<void> => {
    if (paused) {
      changedWhilePaused = true;
      return;
    }
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    // The first read starts with the initial loading state. It has nothing new to publish.
    if (!isLoading) {
      isLoading = true;
      publish();
    }
    try {
      do {
        readAgain = false;
        const readEpoch = events.getStreamHealth().epoch;
        try {
          const next = await readImpact();
          if (readAgain) continue;
          impact = next;
          readError = null;
          const stream = events.getStreamHealth();
          if (stream.error === null && stream.epoch === readEpoch) streamFailure = null;
        } catch (cause) {
          if (readAgain) continue;
          readError = errorMessage(cause);
        }
        isLoading = false;
        publish();
      } while (readAgain && !closed);
    } finally {
      reading = false;
    }
  };

  const unsubscribe = events.subscribeEvents({
    onEvent: (event) => {
      // The MCP bridge carries no sessions, so it never changes a review.
      if (event.type === "mcp_bridge_changed") return;
      const changedKinds =
        event.type === "runtime_changed" ? [event.status.kind] : event.runtimeKinds;
      const reviewed = new Set(kinds());
      if (changedKinds.some((kind) => reviewed.has(kind))) void read();
    },
    onStreamChange: () => {
      const { error } = events.getStreamHealth();
      if (error === null) {
        void read();
        return;
      }
      streamFailure = error;
      publish();
    },
  });
  void read();

  return {
    // The host returns this impact with its answer, so it shows at once, also while paused.
    replace: (next) => {
      impact = next;
      if (!closed) onState({ impact, isLoading, error: streamFailure ?? readError });
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      if (changedWhilePaused) {
        changedWhilePaused = false;
        void read();
        return;
      }
      publish();
    },
    close: () => {
      closed = true;
      unsubscribe();
    },
  };
};

/**
 * Watches the impact while `reviewKey` is not null. A new key starts a new review. The host
 * runtime status owner supplies the events.
 */
export const useRuntimeImpactWatch = ({
  reviewKey,
  kinds,
  readImpact,
  paused,
}: {
  reviewKey: number | null;
  kinds: ReadonlyArray<RuntimeKind>;
  readImpact: () => Promise<RuntimeLifecycleImpact>;
  /** True while the reviewed action runs. */
  paused: boolean;
}): RuntimeImpactState & { replace: (impact: RuntimeLifecycleImpact) => void } => {
  const { runtimeEvents } = useHostRuntimeStatusContext();
  const [watched, setWatched] = useState<{ reviewKey: number; state: RuntimeImpactState } | null>(
    null,
  );
  const watchRef = useRef<RuntimeImpactWatch | null>(null);
  const read = useEffectEvent(readImpact);
  const reviewedKinds = useEffectEvent(() => kinds);

  useEffect(() => {
    if (reviewKey === null) return;
    const watch = watchRuntimeImpact({
      kinds: () => reviewedKinds(),
      readImpact: () => read(),
      events: runtimeEvents,
      onState: (state) => setWatched({ reviewKey, state }),
    });
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [reviewKey, runtimeEvents]);

  useEffect(() => {
    if (paused) watchRef.current?.pause();
    else watchRef.current?.resume();
  }, [paused]);

  const replace = useCallback((impact: RuntimeLifecycleImpact) => {
    watchRef.current?.replace(impact);
  }, []);
  const state = watched !== null && watched.reviewKey === reviewKey ? watched.state : INITIAL_STATE;
  return { ...state, replace };
};

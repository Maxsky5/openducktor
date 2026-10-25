import { useCallback, useMemo, useState } from "react";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";

export type ReplyFailures = {
  /** The failure of each request, by request ID. A lost result is `unknown`. */
  byRequestId: ReadonlyMap<string, CommandFailure>;
  /** Keeps the failure of a reply so the request shows it until the next attempt. */
  record: (requestId: string, cause: unknown, failureTitle: string) => void;
  clear: (requestId: string) => void;
};

const EMPTY: ReadonlyMap<string, CommandFailure> = new Map();

/**
 * The reply failures of the pending input of one session. A reply with a lost result shows
 * "Result unknown" with the host guidance. Nothing sends it again: the reconnect refetch shows
 * whether the host still waits for the reply, and the user decides.
 */
export function useReplyFailures(pendingRequestIds: readonly string[]): ReplyFailures {
  const [failures, setFailures] = useState<ReadonlyMap<string, CommandFailure>>(EMPTY);
  const record = useCallback((requestId: string, cause: unknown, failureTitle: string) => {
    setFailures((current) =>
      new Map(current).set(requestId, toCommandFailure(cause, failureTitle)),
    );
  }, []);
  const clear = useCallback((requestId: string) => {
    setFailures((current) => {
      if (!current.has(requestId)) return current;
      const next = new Map(current);
      next.delete(requestId);
      return next;
    });
  }, []);
  // A request that the host answered leaves the store, and its failure goes with it.
  const byRequestId = useMemo(() => {
    const pending = new Set(pendingRequestIds);
    const kept = new Map<string, CommandFailure>();
    for (const [requestId, failure] of failures) {
      if (pending.has(requestId)) kept.set(requestId, failure);
    }
    return kept.size === failures.size ? failures : kept;
  }, [failures, pendingRequestIds]);
  return useMemo(() => ({ byRequestId, record, clear }), [byRequestId, clear, record]);
}

import { useCallback, useEffect, useRef, useState } from "react";

/** A fast failure still shows progress this long, so the press reads as an attempt, not a flicker. */
const MIN_PENDING_MS = 700;

export type PendingAction = {
  /** True while the action runs. */
  pending: boolean;
  /** The time of the last failed run, or null. */
  failedAt: number | null;
  /** Runs the action once. A press while it runs does nothing. */
  run: () => void;
};

/**
 * Runs an async action from a button and reports its progress. The progress shows for at least
 * a short time, so a retry that fails at once still reads as a retry.
 */
export const usePendingAction = <Result>(
  action: () => Promise<Result>,
  onFailure?: () => void,
): PendingAction => {
  const [pending, setPending] = useState(false);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    const minimum = new Promise<void>((resolve) => setTimeout(() => resolve(), MIN_PENDING_MS));
    void Promise.allSettled([action(), minimum]).then(([result]) => {
      running.current = false;
      if (!mounted.current) return;
      setPending(false);
      if (result.status === "rejected") {
        setFailedAt(Date.now());
        onFailure?.();
      } else {
        setFailedAt(null);
      }
    });
  }, [action, onFailure]);
  return { pending, failedAt, run };
};

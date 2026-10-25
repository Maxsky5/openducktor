import { useCallback, useEffect, useMemo, useRef } from "react";

/** What the screen that asked for a confirmation hears about its confirmed action. */
export type ConfirmationOutcomeListener<Request> = {
  /** The user confirmed the action, and it runs. `onSucceeded` or `onFailed` follows. */
  onStarted?: ((request: Request) => void) | undefined;
  /**
   * The action succeeded. It reports after the confirmation closed, so a screen that leaves does
   * not leave in the same frame. A confirmation that unmounted before the success reports it at
   * once.
   */
  onSucceeded?: ((request: Request) => void) | undefined;
  /** The action failed, and the user closed the confirmation. */
  onFailed?: ((request: Request) => void) | undefined;
};

export type ConfirmationOutcome<Request> = {
  started: (request: Request) => void;
  succeeded: (request: Request) => void;
  /** The confirmation of `requestId` closed, after a cancel, a failure, or a success. */
  closed: (requestId: number) => void;
};

/**
 * Reports the outcome of each confirmed action once, after its confirmation closed. A confirmation
 * that closes without a confirmed action reports nothing.
 */
export function useConfirmationOutcome<Request extends { id: number }>(
  listener: ConfirmationOutcomeListener<Request>,
): ConfirmationOutcome<Request> {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useRef<{ request: Request; succeeded: boolean } | null>(null);
  const started = useCallback((request: Request) => {
    run.current = { request, succeeded: false };
    latest.current.onStarted?.(request);
  }, []);
  const succeeded = useCallback((request: Request) => {
    if (mounted.current) {
      run.current = { request, succeeded: true };
      return;
    }
    run.current = null;
    latest.current.onSucceeded?.(request);
  }, []);
  const closed = useCallback((requestId: number) => {
    const finished = run.current;
    if (finished?.request.id !== requestId) return;
    run.current = null;
    if (finished.succeeded) latest.current.onSucceeded?.(finished.request);
    else latest.current.onFailed?.(finished.request);
  }, []);
  return useMemo(() => ({ started, succeeded, closed }), [closed, started, succeeded]);
}

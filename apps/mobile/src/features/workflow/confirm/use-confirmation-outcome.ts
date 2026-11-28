import { useCallback, useEffect, useMemo, useRef } from "react";

export type ConfirmationOutcomeListener<Request> = {
  onStarted?: ((request: Request) => void) | undefined;
  onSucceeded?: ((request: Request) => void) | undefined;
  onFailed?: ((request: Request) => void) | undefined;
};

export type ConfirmationOutcome<Request> = {
  started: (request: Request) => void;
  succeeded: (request: Request) => void;
  failed: (request: Request) => void;
  closed: (requestId: number) => void;
};

/** Waits for both native dismissal and the command result before reporting to a screen. */
export function useConfirmationOutcome<Request extends { id: number }>(
  listener: ConfirmationOutcomeListener<Request>,
): ConfirmationOutcome<Request> {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  }, [listener]);
  const runs = useRef(
    new Map<
      number,
      {
        request: Request;
        closed: boolean;
        outcome?: "succeeded" | "failed";
      }
    >(),
  );
  useEffect(
    () => () => {
      runs.current.clear();
    },
    [],
  );
  const finish = useCallback((id: number) => {
    const run = runs.current.get(id);
    if (!run?.closed || !run.outcome) return;
    runs.current.delete(id);
    if (run.outcome === "succeeded") latest.current.onSucceeded?.(run.request);
    else latest.current.onFailed?.(run.request);
  }, []);
  const started = useCallback((request: Request) => {
    runs.current.set(request.id, { request, closed: false });
    latest.current.onStarted?.(request);
  }, []);
  const settle = useCallback(
    (request: Request, outcome: "succeeded" | "failed") => {
      const run = runs.current.get(request.id);
      if (!run) return;
      run.outcome = outcome;
      finish(request.id);
    },
    [finish],
  );
  const closed = useCallback(
    (id: number) => {
      const run = runs.current.get(id);
      if (!run) return;
      run.closed = true;
      finish(id);
    },
    [finish],
  );
  return useMemo(
    () => ({
      started,
      succeeded: (request) => settle(request, "succeeded"),
      failed: (request) => settle(request, "failed"),
      closed,
    }),
    [closed, settle, started],
  );
}

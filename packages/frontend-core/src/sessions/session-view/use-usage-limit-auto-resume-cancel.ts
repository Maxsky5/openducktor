import type { UsageLimitAutoResume } from "@openducktor/contracts";
import { useCallback, useState } from "react";
import { errorMessage } from "../../lib/errors";
import { useSingleFlight } from "../../lib/use-single-flight";

type CancelState = { stopId: string; pending: boolean; error: string | null };

export type UsageLimitAutoResumeCancel = {
  readonly cancel: () => void;
  readonly isCanceling: boolean;
  /** The failure text of the latest cancel of this stop, ready to show. */
  readonly error: string | null;
};

/**
 * Runs Cancel auto-resume for the planned stop of a session. The pending and failure state
 * belongs to one stop, so a new stop starts without them. The host publishes the removal itself.
 */
export const useUsageLimitAutoResumeCancel = (
  autoResume: UsageLimitAutoResume | undefined,
  cancelStop: (stopId: string) => Promise<void>,
): UsageLimitAutoResumeCancel => {
  const [state, setState] = useState<CancelState | null>(null);
  const flight = useSingleFlight();
  const stopId = autoResume?.stopId;
  const cancel = useCallback((): void => {
    if (stopId === undefined) return;
    void flight.start(() => {
      setState({ stopId, pending: true, error: null });
      return cancelStop(stopId).then(
        () => setState(null),
        (cause: unknown) => setState({ stopId, pending: false, error: errorMessage(cause) }),
      );
    });
  }, [cancelStop, flight, stopId]);
  const current = state?.stopId === stopId ? state : null;
  return {
    cancel,
    isCanceling: current?.pending === true,
    error: current?.error ? `Cancel failed: ${current.error}` : null,
  };
};

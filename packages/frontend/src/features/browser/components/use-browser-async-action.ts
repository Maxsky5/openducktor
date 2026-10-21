import { useRef, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";

export type BrowserAsyncAction = {
  /** True while an action runs. */
  pending: boolean;
  /** The message of the last rejected action, or null. */
  error: string | null;
  /** Runs one action at a time. A call while another action runs does nothing. */
  run: (action: () => Promise<void>) => Promise<void>;
};

/** Runs an async answer or command and keeps its pending state and error visible. */
export function useBrowserAsyncAction(): BrowserAsyncAction {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      runningRef.current = false;
      setPending(false);
    }
  };

  return { pending, error, run };
}

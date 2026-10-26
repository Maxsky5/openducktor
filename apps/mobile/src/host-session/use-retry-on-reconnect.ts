import { useEffect, useRef } from "react";

/**
 * Runs `retry` once each time the connection opens again, so a read that failed while the host
 * was away, such as the session history, loads by itself. A null `retry` has nothing to read.
 */
export const useRetryOnReconnect = (open: boolean, retry: (() => void) | null): void => {
  const wasOpen = useRef(open);
  useEffect(() => {
    const reopened = open && !wasOpen.current;
    wasOpen.current = open;
    // A new retry while the connection stays open runs nothing.
    if (reopened) retry?.();
  }, [open, retry]);
};

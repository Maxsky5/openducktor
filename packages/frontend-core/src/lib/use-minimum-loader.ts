import { useEffect, useState } from "react";

/** A loader that shows stays at least this long, so a fast read does not flash it. */
export const MINIMUM_LOADER_MS = 500;

/**
 * Whether a loader shows. It shows while `pending` is true, and once it shows, it stays at least
 * `MINIMUM_LOADER_MS`. Content that is ready when the view opens shows at once, with no loader.
 */
export function useMinimumLoader(pending: boolean): boolean {
  const [shownAt, setShownAt] = useState<number | null>(null);
  useEffect(() => {
    if (pending) {
      if (shownAt === null) setShownAt(Date.now());
      return;
    }
    if (shownAt === null) return;
    const remaining = MINIMUM_LOADER_MS - (Date.now() - shownAt);
    if (remaining <= 0) {
      setShownAt(null);
      return;
    }
    const timer = setTimeout(() => setShownAt(null), remaining);
    return () => clearTimeout(timer);
  }, [pending, shownAt]);
  return pending || shownAt !== null;
}

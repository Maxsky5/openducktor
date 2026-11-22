import { useEffect, useState } from "react";

/** A skeleton stays at least this long, so a fast answer never flashes it. */
export const SKELETON_MIN_MS = 500;

/**
 * True while the skeleton shows: as long as `waiting`, and for at least `SKELETON_MIN_MS` from
 * the moment it appeared. A page that has its data at once never shows it.
 */
export const useSkeletonHold = (waiting: boolean): boolean => {
  const [shownSince, setShownSince] = useState<number | null>(() => (waiting ? Date.now() : null));
  useEffect(() => {
    if (waiting) {
      setShownSince((since) => since ?? Date.now());
      return;
    }
    if (shownSince === null) return;
    const timer = setTimeout(
      () => setShownSince(null),
      Math.max(0, shownSince + SKELETON_MIN_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [waiting, shownSince]);
  return waiting || shownSince !== null;
};

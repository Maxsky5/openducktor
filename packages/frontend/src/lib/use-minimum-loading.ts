import { useEffect, useRef, useState } from "react";

/**
 * Keeps a loading state on for at least `minimumMs` after it starts. Fast work then shows one
 * loader and one final state, instead of a short flash of each.
 */
export function useMinimumLoading(isLoading: boolean, minimumMs: number): boolean {
  const [holding, setHolding] = useState(isLoading);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (isLoading) {
      startedAt.current ??= Date.now();
      setHolding(true);
      return;
    }
    if (startedAt.current === null) return;
    const remainingMs = minimumMs - (Date.now() - startedAt.current);
    startedAt.current = null;
    if (remainingMs <= 0) {
      setHolding(false);
      return;
    }
    const timer = setTimeout(() => setHolding(false), remainingMs);
    return () => clearTimeout(timer);
  }, [isLoading, minimumMs]);
  return isLoading || holding;
}

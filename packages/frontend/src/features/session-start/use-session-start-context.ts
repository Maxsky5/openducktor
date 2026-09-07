import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/** A callback captured by an operation becomes stale after any context switch. */
export function useSessionStartContext(key: string | null): () => boolean {
  const context = useMemo(() => ({ key }), [key]);
  const current = useRef(context);
  useLayoutEffect(() => {
    current.current = context;
    return () => {
      current.current = { key: null };
    };
  }, [context]);
  return useCallback(() => current.current === context, [context]);
}

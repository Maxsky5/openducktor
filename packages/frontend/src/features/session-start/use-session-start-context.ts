import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/**
 * Tracks the context of a long-running operation.
 * An operation stays valid while the key stays the same and the owner stays mounted.
 * A key change or an unmount cancels the operation.
 * A route change does not cancel an operation when the owner lives above the routes.
 */
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

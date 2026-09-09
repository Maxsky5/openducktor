import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/** An operation stays canceled after leaving its context, even if that context is selected again. */
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

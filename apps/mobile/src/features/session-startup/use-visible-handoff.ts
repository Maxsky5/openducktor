import { useCallback, useEffect, useRef } from "react";
import { appStateVisibility } from "@/composition/app-visibility";

/** Hiding the app defers navigation without changing the user's startup presentation choice. */
export const useVisibleHandoff = (): ((handoff: () => void) => Promise<void>) => {
  const pending = useRef<{ handoff: () => void; resolve: () => void } | null>(null);
  useEffect(() => {
    const unsubscribe = appStateVisibility.subscribe(() => {
      if (appStateVisibility.isHidden()) return;
      const next = pending.current;
      pending.current = null;
      if (next) {
        next.handoff();
        next.resolve();
      }
    });
    return () => {
      pending.current?.resolve();
      pending.current = null;
      unsubscribe();
    };
  }, []);
  return useCallback(
    (handoff: () => void) =>
      new Promise<void>((resolve) => {
        if (appStateVisibility.isHidden()) {
          pending.current?.resolve();
          pending.current = { handoff, resolve };
        } else {
          handoff();
          resolve();
        }
      }),
    [],
  );
};

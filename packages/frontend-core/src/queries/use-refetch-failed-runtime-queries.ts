import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { AppVisibility } from "../platform/app-visibility";
import type { SystemWake } from "../platform/system-wake";
import { refetchFailedRuntimeQueries } from "./runtime-query-invalidation";

/**
 * Reads the failed runtime reads of the shown views again each time the user returns to the app,
 * and after each system wake that the shell reports.
 */
export function useRefetchFailedRuntimeQueries(
  visibility: AppVisibility,
  systemWake: SystemWake | undefined,
): void {
  const queryClient = useQueryClient();
  // One return can report more than one change, such as focus and visibility, or a wake and an
  // unlock, so one re-read runs at a time.
  const running = useRef<Promise<void> | null>(null);
  useEffect(() => {
    const refetch = () => {
      running.current ??= refetchFailedRuntimeQueries(queryClient).finally(() => {
        running.current = null;
      });
    };
    const stopVisibility = visibility.subscribe(() => {
      if (!visibility.isHidden()) refetch();
    });
    const stopWake = systemWake?.subscribe(refetch);
    return () => {
      stopVisibility();
      stopWake?.();
    };
  }, [queryClient, systemWake, visibility]);
}

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
  useEffect(() => {
    const refetch = () => void refetchFailedRuntimeQueries(queryClient);
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

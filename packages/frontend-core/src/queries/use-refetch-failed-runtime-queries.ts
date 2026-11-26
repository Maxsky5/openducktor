import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AppVisibility, SystemWake } from "../platform/app-visibility";
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
  useEffect(
    () =>
      visibility.subscribe(() => {
        if (!visibility.isHidden()) void refetchFailedRuntimeQueries(queryClient);
      }),
    [queryClient, visibility],
  );
  useEffect(
    () => systemWake?.subscribe(() => void refetchFailedRuntimeQueries(queryClient)),
    [queryClient, systemWake],
  );
}

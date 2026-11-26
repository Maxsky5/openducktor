import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AppVisibility } from "../platform/app-visibility";
import { refetchFailedRuntimeQueries } from "./runtime-query-invalidation";

/** Reads the failed runtime reads of the shown views again each time the user returns to the app. */
export function useRefetchFailedRuntimeQueries(visibility: AppVisibility): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      visibility.subscribe(() => {
        if (!visibility.isHidden()) void refetchFailedRuntimeQueries(queryClient);
      }),
    [queryClient, visibility],
  );
}

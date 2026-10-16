import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { readRuntimeKindReadiness } from "@/lib/runtime-readiness";
import { useHostRuntimeStatusContext } from "@/state/app-state-contexts";
import {
  type CachedRuntimeCatalog,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "./runtime-catalog";

type RuntimeCatalogLoader = (
  runtimeRef: RuntimeWorkingDirectoryRef,
) => Promise<AgentRuntimeCatalog>;

/**
 * Reads the catalog of one runtime directory. The read starts only when the caller enables it and
 * the host reports the runtime kind as ready, so no catalog request reaches a starting runtime.
 */
export function useRuntimeCatalogQuery({
  runtimeRef,
  loadRuntimeCatalog,
  enabled = true,
}: {
  runtimeRef: RuntimeWorkingDirectoryRef | null;
  loadRuntimeCatalog: RuntimeCatalogLoader;
  enabled?: boolean;
}): UseQueryResult<CachedRuntimeCatalog, Error> {
  const runtimeStatus = useHostRuntimeStatusContext();
  const runtime = runtimeRef ? RUNTIME_DESCRIPTORS_BY_KIND[runtimeRef.runtimeKind] : null;
  const isRuntimeReady =
    runtime !== null && readRuntimeKindReadiness(runtimeStatus, runtime).state === "ready";
  return useQuery({
    ...(runtimeRef
      ? runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions()),
    enabled: enabled && isRuntimeReady,
  });
}

/** Refreshes a stale catalog in the background. It skips a runtime that is not ready. */
export function useRefreshStaleRuntimeCatalog(
  loadRuntimeCatalog: RuntimeCatalogLoader,
): (runtimeRef: RuntimeWorkingDirectoryRef) => void {
  const queryClient = useQueryClient();
  const runtimeStatus = useHostRuntimeStatusContext();
  return useCallback(
    (runtimeRef) => {
      const runtime = RUNTIME_DESCRIPTORS_BY_KIND[runtimeRef.runtimeKind];
      if (readRuntimeKindReadiness(runtimeStatus, runtime).state !== "ready") {
        return;
      }
      void queryClient
        .fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog))
        .catch(() => undefined);
    },
    [loadRuntimeCatalog, queryClient, runtimeStatus],
  );
}

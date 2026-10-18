import "@openducktor/frontend-core/queries/query-meta";
import { queryOptions, skipToken } from "@tanstack/react-query";
import type { ResourceRead } from "@/types/resource-source";

export const resourceSourceQueryOptions = (
  key: readonly string[],
  generation: number,
  read: ResourceRead | undefined,
) =>
  queryOptions({
    queryKey: read ? ["resource-source", generation, ...key] : ["resource-source", "skipped"],
    queryFn: read ? ({ signal }) => read(signal) : skipToken,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    // A resource view reports its own failure and retries when the user asks.
    meta: { skipHostRecovery: true },
  });

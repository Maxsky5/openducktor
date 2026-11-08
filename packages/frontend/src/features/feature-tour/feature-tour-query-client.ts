import { QueryClient } from "@tanstack/react-query";

/**
 * A query cache for the real app parts of a picture. A picture has no host connection, so the
 * cache keeps its seeded data and never fetches: no mount, focus, or reconnect refetches it.
 */
export const createTourQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
      },
    },
  });

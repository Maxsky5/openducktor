import { QueryClient } from "@tanstack/react-query";

const MINUTE_MS = 60_000;

/** Query defaults stop hidden retries and refetches after focus or reconnect. */
export const createClientQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: MINUTE_MS,
        gcTime: 10 * MINUTE_MS,
      },
      mutations: {
        retry: false,
      },
    },
  });

import { QueryClient } from "@tanstack/react-query";

const MINUTE_MS = 60_000;

/** Host connections handle failures and recovery, so browser offline events must not pause reads. */
export const createClientQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
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

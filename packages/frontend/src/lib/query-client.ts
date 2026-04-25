import { QueryClient } from "@tanstack/react-query";

const MINUTE_MS = 60_000;

export const createQueryClient = (): QueryClient =>
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

export const appQueryClient = createQueryClient();

export const clearAppQueryClient = async (): Promise<void> => {
  await appQueryClient.cancelQueries();
  appQueryClient.clear();
};

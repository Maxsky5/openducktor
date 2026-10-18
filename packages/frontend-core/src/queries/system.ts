import type { AppPlatform, SystemOpenInToolInfo } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

const OPEN_IN_TOOLS_STALE_TIME_MS = 5 * 60 * 1000;
const PLATFORM_STALE_TIME_MS = Number.POSITIVE_INFINITY;

export const systemQueryKeys = {
  all: ["system"] as const,
  platform: () => [...systemQueryKeys.all, "platform"] as const,
  openInTools: () => [...systemQueryKeys.all, "open-in-tools"] as const,
};

export const platformQueryOptions = () =>
  queryOptions({
    queryKey: systemQueryKeys.platform(),
    queryFn: ({ client }): Promise<AppPlatform> => connectionHost(client).systemGetPlatform(),
    staleTime: PLATFORM_STALE_TIME_MS,
    gcTime: PLATFORM_STALE_TIME_MS,
  });

export const openInToolsQueryOptions = () =>
  queryOptions({
    queryKey: systemQueryKeys.openInTools(),
    queryFn: ({ client }): Promise<SystemOpenInToolInfo[]> =>
      connectionHost(client).systemListOpenInTools(),
    staleTime: OPEN_IN_TOOLS_STALE_TIME_MS,
  });

export const loadOpenInToolsFromQuery = (
  queryClient: QueryClient,
): Promise<SystemOpenInToolInfo[]> => queryClient.fetchQuery(openInToolsQueryOptions());

export const ensureOpenInToolsFromQuery = (
  queryClient: QueryClient,
): Promise<SystemOpenInToolInfo[]> => queryClient.ensureQueryData(openInToolsQueryOptions());

export const refreshOpenInToolsFromQuery = (
  queryClient: QueryClient,
): Promise<SystemOpenInToolInfo[]> => {
  return connectionHost(queryClient)
    .systemListOpenInTools(true)
    .then((tools) => {
      queryClient.setQueryData(systemQueryKeys.openInTools(), tools);
      return tools;
    });
};

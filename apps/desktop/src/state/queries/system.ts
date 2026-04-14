import type { SystemOpenInToolInfo } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

type SystemOpenInToolsQueryHost = Pick<typeof host, "systemListOpenInTools">;

const OPEN_IN_TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

export const systemQueryKeys = {
  all: ["system"] as const,
  openInTools: () => [...systemQueryKeys.all, "open-in-tools"] as const,
};

export const openInToolsQueryOptions = (
  hostClient: SystemOpenInToolsQueryHost = host,
  forceRefresh = false,
) =>
  queryOptions({
    queryKey: systemQueryKeys.openInTools(),
    queryFn: (): Promise<SystemOpenInToolInfo[]> => hostClient.systemListOpenInTools(forceRefresh),
    staleTime: OPEN_IN_TOOLS_STALE_TIME_MS,
  });

export const loadOpenInToolsFromQuery = (
  queryClient: QueryClient,
  hostClient?: SystemOpenInToolsQueryHost,
): Promise<SystemOpenInToolInfo[]> => queryClient.fetchQuery(openInToolsQueryOptions(hostClient));

export const ensureOpenInToolsFromQuery = (
  queryClient: QueryClient,
  hostClient?: SystemOpenInToolsQueryHost,
): Promise<SystemOpenInToolInfo[]> =>
  queryClient.ensureQueryData(openInToolsQueryOptions(hostClient));

export const refreshOpenInToolsFromQuery = (
  queryClient: QueryClient,
  hostClient: SystemOpenInToolsQueryHost = host,
): Promise<SystemOpenInToolInfo[]> => {
  return hostClient.systemListOpenInTools(true).then((tools) => {
    queryClient.setQueryData(systemQueryKeys.openInTools(), tools);
    return tools;
  });
};

import type { AppPlatform, SystemOpenInToolInfo } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

type SystemOpenInToolsQueryHost = Pick<typeof host, "systemListOpenInTools">;
type SystemPlatformQueryHost = Pick<typeof host, "systemGetPlatform">;

const OPEN_IN_TOOLS_STALE_TIME_MS = 5 * 60 * 1000;
const PLATFORM_STALE_TIME_MS = Number.POSITIVE_INFINITY;

export const systemQueryKeys = {
  all: ["system"] as const,
  platform: () => [...systemQueryKeys.all, "platform"] as const,
  openInTools: () => [...systemQueryKeys.all, "open-in-tools"] as const,
};

export const platformQueryOptions = (hostClient: SystemPlatformQueryHost = host) =>
  queryOptions({
    queryKey: systemQueryKeys.platform(),
    queryFn: (): Promise<AppPlatform> => hostClient.systemGetPlatform(),
    staleTime: PLATFORM_STALE_TIME_MS,
    gcTime: PLATFORM_STALE_TIME_MS,
  });

export const openInToolsQueryOptions = (hostClient: SystemOpenInToolsQueryHost = host) =>
  queryOptions({
    queryKey: systemQueryKeys.openInTools(),
    queryFn: (): Promise<SystemOpenInToolInfo[]> => hostClient.systemListOpenInTools(),
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

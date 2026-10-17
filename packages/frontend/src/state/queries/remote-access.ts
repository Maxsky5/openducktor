import type { RemoteAccessBridge } from "@openducktor/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

export const remoteAccessQueryKey = ["shell", "remote-access"] as const;

export const remoteAccessStateQueryOptions = (bridge: RemoteAccessBridge | undefined) =>
  queryOptions({
    queryKey: remoteAccessQueryKey,
    queryFn: bridge ? () => bridge.readState() : skipToken,
    staleTime: Infinity,
  });

export const remoteAccessNetworksQueryOptions = (bridge: RemoteAccessBridge) =>
  queryOptions({
    queryKey: [...remoteAccessQueryKey, "networks"],
    queryFn: () => bridge.readNetworks(),
    staleTime: 0,
  });

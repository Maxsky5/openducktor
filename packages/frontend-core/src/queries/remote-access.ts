import type { RemoteAccessBridge } from "@openducktor/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import "./query-meta";

export const remoteAccessQueryKey = ["shell", "remote-access"] as const;

export const remoteAccessStateQueryOptions = (bridge: RemoteAccessBridge | undefined) =>
  queryOptions({
    queryKey: remoteAccessQueryKey,
    queryFn: bridge ? () => bridge.readState() : skipToken,
    staleTime: Infinity,
    // Remote access belongs to this device, not to the selected host.
    meta: { skipHostRecovery: true },
  });

export const remoteAccessNetworksQueryOptions = (bridge: RemoteAccessBridge) =>
  queryOptions({
    queryKey: [...remoteAccessQueryKey, "networks"],
    queryFn: () => bridge.readNetworks(),
    staleTime: 0,
    meta: { skipHostRecovery: true },
  });

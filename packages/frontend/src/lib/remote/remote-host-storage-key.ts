import { canonicalRemoteEndpoint } from "@openducktor/host-client/remote";

/** The device storage key of `name` for one remote host. Each host has its own key. */
export const remoteHostStorageKey = (name: string, endpoint: string): string =>
  `openducktor:${name}:v1:${encodeURIComponent(canonicalRemoteEndpoint(endpoint))}`;

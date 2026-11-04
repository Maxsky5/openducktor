import {
  canonicalRemoteEndpoint,
  createRemoteAuthorizationStore,
} from "@openducktor/host-client/remote";

const key = (endpoint: string) =>
  `openducktor:remote-authorization:v1:${encodeURIComponent(canonicalRemoteEndpoint(endpoint))}`;
export const browserRemoteAuthorizationStore = createRemoteAuthorizationStore({
  get: async (endpoint) => localStorage.getItem(key(endpoint)),
  set: async (endpoint, text) => localStorage.setItem(key(endpoint), text),
});

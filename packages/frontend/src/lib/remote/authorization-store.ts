import { createRemoteAuthorizationStore } from "@openducktor/host-client/remote";
import { remoteHostStorageKey } from "./remote-host-storage-key";

const key = (endpoint: string) => remoteHostStorageKey("remote-authorization", endpoint);
export const browserRemoteAuthorizationStore = createRemoteAuthorizationStore({
  get: async (endpoint) => localStorage.getItem(key(endpoint)),
  set: async (endpoint, text) => localStorage.setItem(key(endpoint), text),
});

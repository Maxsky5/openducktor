import {
  createRemoteAuthorizationStore,
  type RemoteAuthorizationStore,
} from "@openducktor/host-client/remote";

export interface SecureCredentialStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
const key = (hostId: string) => `openducktor.remote-authorization.v1.${hostId}`;

/** One saved host keeps one saved access, so the key is the saved host, not the endpoint. */
export const createDeviceAuthorizationStore = (
  hostId: string,
  storage: SecureCredentialStorage,
): RemoteAuthorizationStore =>
  createRemoteAuthorizationStore({
    get: () => storage.getItemAsync(key(hostId)),
    set: (_endpoint, text) => storage.setItemAsync(key(hostId), text),
  });
export const deleteDeviceAuthorization = (
  hostId: string,
  storage: SecureCredentialStorage,
): Promise<void> => storage.deleteItemAsync(key(hostId));

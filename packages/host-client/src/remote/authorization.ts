import {
  remoteAuthorizationSchema,
  remoteEndpointSchema,
  type RemoteAuthorization,
  parseRemoteAuthorizationToken,
} from "@openducktor/contracts";
import { z } from "zod";
import { remoteError } from "./transport";

export const savedRemoteAuthorizationSchema = z.strictObject({
  version: z.literal(1),
  endpoint: remoteEndpointSchema,
  authorization: remoteAuthorizationSchema,
});
export type SavedRemoteAuthorization = z.infer<typeof savedRemoteAuthorizationSchema>;
export interface RemoteAuthorizationStore {
  read(endpoint: string): Promise<SavedRemoteAuthorization | null>;
  save(value: SavedRemoteAuthorization): Promise<void>;
}

/** Saved access over a text storage, such as browser storage or the device keychain. */
export const createRemoteAuthorizationStore = (storage: {
  get(endpoint: string): Promise<string | null>;
  set(endpoint: string, text: string): Promise<void>;
}): RemoteAuthorizationStore => ({
  async read(endpoint) {
    const text = await storage.get(endpoint);
    if (text === null) return null;
    try {
      return savedRemoteAuthorizationSchema.parse(JSON.parse(text));
    } catch {
      throw remoteError(
        "authorization_rejected",
        "Saved access is damaged.",
        "Enter the current host pairing code.",
      );
    }
  },
  save: (value) =>
    storage.set(value.endpoint, JSON.stringify(savedRemoteAuthorizationSchema.parse(value))),
});
export type RemoteConnectInput = { pairingCode?: string; signal?: AbortSignal };
export const canonicalRemoteEndpoint = (endpoint: string): string =>
  new URL(endpoint).href.replace(/\/$/, "");
export { isRemotePairingFailure } from "@openducktor/contracts";

export const authorizationMatches = (authorization: RemoteAuthorization, hostId: string): boolean =>
  authorization.hostId === hostId &&
  parseRemoteAuthorizationToken(authorization.token)?.clientId === authorization.clientId;

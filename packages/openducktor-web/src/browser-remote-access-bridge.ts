import {
  type RemoteAccessState,
  remoteAccessStateSchema,
  remoteAccessNetworksSchema,
  type RemoteAccessBridge,
  type RemoteAccessEnableInput,
  type RemotePairingStartInput,
} from "@openducktor/contracts";
import { getBrowserBackendUrl, getBrowserAuthToken } from "./browser-config";
import { ensureLocalHostSession } from "./local-host-transport";
import { REMOTE_ACCESS_PATH } from "./remote-access-path";
/** `observeState` delivers the live remote access state of the local operator. */
export const createBrowserRemoteAccessBridge = (
  observeState: (listener: (state: RemoteAccessState) => void) => Promise<() => void>,
): RemoteAccessBridge => {
  const request = async (
    path: string,
    body?: RemoteAccessEnableInput | RemotePairingStartInput | Record<string, never>,
  ) => {
    await ensureLocalHostSession();
    const headers = new Headers({ "x-openducktor-app-token": getBrowserAuthToken() });
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      redirect: "error",
      headers,
    };
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${getBrowserBackendUrl()}${REMOTE_ACCESS_PATH}${path}`, init);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        detail ||
          `Remote operator request failed with HTTP ${response.status}. Open the local operator URL and retry.`,
      );
    }
    const value: unknown = await response.json();
    return value;
  };
  return {
    readState: async () => remoteAccessStateSchema.parse(await request("")),
    readNetworks: async () => remoteAccessNetworksSchema.parse(await request("/networks")),
    enable: async (input) => remoteAccessStateSchema.parse(await request("/enable", input)),
    revokeClient: async (clientId) =>
      remoteAccessStateSchema.parse(
        await request(`/clients/${encodeURIComponent(clientId)}/revoke`, {}),
      ),
    disable: async () => remoteAccessStateSchema.parse(await request("/disable", {})),
    startPairing: async (options) =>
      remoteAccessStateSchema.parse(
        await request("/pairing/start", { renew: options?.renew === true }),
      ),
    stopPairing: async () => remoteAccessStateSchema.parse(await request("/pairing/stop", {})),
    subscribeState: observeState,
  };
};

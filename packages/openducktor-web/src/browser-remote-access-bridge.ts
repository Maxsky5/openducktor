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
    const response = await fetch(`${getBrowserBackendUrl()}${path}`, init);
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
    readState: async () => remoteAccessStateSchema.parse(await request("/remote-access")),
    readNetworks: async () =>
      remoteAccessNetworksSchema.parse(await request("/remote-access/networks")),
    enable: async (input) =>
      remoteAccessStateSchema.parse(await request("/remote-access/enable", input)),
    revokeClient: async (clientId) =>
      remoteAccessStateSchema.parse(
        await request(`/remote-access/clients/${encodeURIComponent(clientId)}/revoke`, {}),
      ),
    disable: async () => remoteAccessStateSchema.parse(await request("/remote-access/disable", {})),
    startPairing: async (options) =>
      remoteAccessStateSchema.parse(
        await request("/remote-access/pairing/start", { renew: options?.renew === true }),
      ),
    stopPairing: async () =>
      remoteAccessStateSchema.parse(await request("/remote-access/pairing/stop", {})),
    subscribeState: observeState,
  };
};

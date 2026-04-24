import type { TauriHostClient } from "@openducktor/adapters-tauri-host";
import { getShellBridge, type HostBridge } from "./shell-bridge";

const hostClientProxy = new Proxy(
  {},
  {
    get(_target, propertyKey) {
      const value = getShellBridge().client[propertyKey as keyof TauriHostClient];
      if (typeof value === "function") {
        return value.bind(getShellBridge().client);
      }
      return value;
    },
  },
) as TauriHostClient;

export const createHostBridge = (): HostBridge => getShellBridge();

export const hostBridge: HostBridge = {
  client: hostClientProxy,
  subscribeRunEvents: (listener) => getShellBridge().subscribeRunEvents(listener),
  subscribeDevServerEvents: (listener) => getShellBridge().subscribeDevServerEvents(listener),
  subscribeTaskEvents: (listener) => getShellBridge().subscribeTaskEvents(listener),
};

export const hostClient = hostClientProxy;

export const subscribeDevServerEvents = hostBridge.subscribeDevServerEvents;
export const subscribeTaskEvents = hostBridge.subscribeTaskEvents;

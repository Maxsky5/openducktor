import type { TauriHostClient } from "@openducktor/adapters-tauri-host";
import { getShellBridge, type HostBridge } from "./shell-bridge";

const hostClientOverrides = new Map<PropertyKey, { value: unknown; restoreValue: unknown }>();
const shellClientMethodBindings = new WeakMap<object, Map<PropertyKey, unknown>>();

const readShellClientValue = (propertyKey: PropertyKey): unknown => {
  const client = getShellBridge().client;
  const value = client[propertyKey as keyof TauriHostClient];
  if (typeof value !== "function") {
    return value;
  }

  const clientObject = client as object;
  const existingBindings = shellClientMethodBindings.get(clientObject) ?? new Map();
  if (!shellClientMethodBindings.has(clientObject)) {
    shellClientMethodBindings.set(clientObject, existingBindings);
  }
  const existingBinding = existingBindings.get(propertyKey);
  if (existingBinding) {
    return existingBinding;
  }

  const boundValue = value.bind(client);
  existingBindings.set(propertyKey, boundValue);
  return boundValue;
};

const hostClientProxy = new Proxy(
  {},
  {
    get(_target, propertyKey) {
      const override = hostClientOverrides.get(propertyKey);
      if (override) {
        return override.value;
      }
      return readShellClientValue(propertyKey);
    },
    set(_target, propertyKey, value) {
      const existingOverride = hostClientOverrides.get(propertyKey);
      const restoreValue = existingOverride?.restoreValue ?? readShellClientValue(propertyKey);
      if (value === restoreValue) {
        hostClientOverrides.delete(propertyKey);
        return true;
      }
      hostClientOverrides.set(propertyKey, { value, restoreValue });
      return true;
    },
    deleteProperty(_target, propertyKey) {
      hostClientOverrides.delete(propertyKey);
      return true;
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

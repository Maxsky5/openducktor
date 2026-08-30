import type { HostClient } from "@openducktor/host-client";
import { getShellBridge, type HostBridge } from "./shell-bridge";

const hostClientOverrides = new Map<PropertyKey, { value: unknown; restoreValue: unknown }>();
type HostClientValue = HostClient[keyof HostClient];
const shellClientMethodBindings = new WeakMap<object, Map<PropertyKey, HostClientValue>>();

const isHostClientKey = (client: HostClient, key: PropertyKey): key is keyof HostClient =>
  Object.hasOwn(client, key);

const readShellClientValue = (propertyKey: PropertyKey): HostClientValue | undefined => {
  const client = getShellBridge().client;
  if (!isHostClientKey(client, propertyKey)) {
    return undefined;
  }
  const value = client[propertyKey];

  let existingBindings = shellClientMethodBindings.get(client);
  if (!existingBindings) {
    existingBindings = new Map();
    shellClientMethodBindings.set(client, existingBindings);
  }
  const existingBinding = existingBindings.get(propertyKey);
  if (existingBinding) {
    return existingBinding;
  }

  const boundValue = value.bind(client);
  existingBindings.set(propertyKey, boundValue);
  return boundValue;
};

// SAFETY: The traps implement the HostClient surface while the empty target preserves the existing virtual proxy behavior.
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
) as HostClient;

export const createHostBridge = (): HostBridge => getShellBridge();

export const hostBridge: HostBridge = {
  client: hostClientProxy,
  subscribeRunEvents: (listener) => getShellBridge().subscribeRunEvents(listener),
  subscribeDevServerEvents: (listener) => getShellBridge().subscribeDevServerEvents(listener),
  observeAgentSessionLive: (input, listener) =>
    getShellBridge().observeAgentSessionLive(input, listener),
  subscribeTaskStream: (input, onFrame, onTerminalFailure) =>
    getShellBridge().subscribeTaskStream(input, onFrame, onTerminalFailure),
};

export const hostClient = hostClientProxy;

export const subscribeDevServerEvents = hostBridge.subscribeDevServerEvents;
export const observeAgentSessionLive = hostBridge.observeAgentSessionLive;
export const subscribeTaskStream = hostBridge.subscribeTaskStream;

import { hasOwnKey, hasRuntimeType } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { getShellBridge, type HostBridge } from "./shell-bridge";

const hostClientOverrides = new Map<PropertyKey, { value: unknown; restoreValue: unknown }>();
type HostClientValue = HostClient[keyof HostClient];
const shellClientMethodBindings = new WeakMap<object, Map<PropertyKey, HostClientValue>>();

const readShellClientValue = (propertyKey: PropertyKey): HostClientValue | undefined => {
  const client = getShellBridge().client;
  if (!hasOwnKey(client, propertyKey)) {
    return undefined;
  }
  const value = client[propertyKey];
  if (!hasRuntimeType(value, "function")) {
    return value;
  }

  let existingBindings = shellClientMethodBindings.get(client);
  if (!existingBindings) {
    existingBindings = new Map();
    shellClientMethodBindings.set(client, existingBindings);
  }
  const existingBinding = existingBindings.get(propertyKey);
  if (existingBinding) {
    return existingBinding;
  }

  // SAFETY: binding changes only the receiver; the HostClient method signature stays unchanged.
  const boundValue = value.bind(client) as HostClientValue;
  existingBindings.set(propertyKey, boundValue);
  return boundValue;
};

// SAFETY: Every HostClient property read is forwarded to the schema-backed shell client after hasOwnKey validation; the proxy target stores no independent state.
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

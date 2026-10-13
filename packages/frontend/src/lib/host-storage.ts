import { getShellBridge } from "./shell-bridge";

const values = new Map<string, string>();
const transientStorage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => {
    values.delete(key);
  },
  setItem: (key, value) => {
    values.set(key, value);
  },
};

/** Remote selections must not read or replace this device's saved local-host drafts. */
export function getHostStorage(): Storage {
  return getShellBridge().remoteConnection ? transientStorage : globalThis.localStorage;
}

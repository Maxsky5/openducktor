import { createMMKV, deleteMMKV, type MMKV } from "react-native-mmkv";
import type { DeviceKeyValueStore } from "./device-store";

/** App records: the saved host list and device preferences. */
export const openAppStore = (): DeviceKeyValueStore => createMMKV({ id: "openducktor.app" });

const hostStoreId = (hostId: string): string => `openducktor.host.${hostId}`;

// react-native-mmkv keeps an AppState listener on each instance that it creates, and
// `deleteMMKV` frees the native store under that listener: the next return to the foreground then
// crashes the app. So each host store opens once, and a store that is open in this process is
// emptied instead of deleted.
const openHostStores = new Map<string, MMKV>();

/** One instance for each saved host, so removing a host removes all its data at once. */
export const openHostStore = (hostId: string): DeviceKeyValueStore => {
  const id = hostStoreId(hostId);
  const open = openHostStores.get(id);
  if (open) return open;
  const store = createMMKV({ id });
  openHostStores.set(id, store);
  return store;
};

export const deleteHostStore = (hostId: string): void => {
  const id = hostStoreId(hostId);
  const open = openHostStores.get(id);
  if (!open) {
    deleteMMKV(id);
    return;
  }
  open.clearAll();
  open.trim();
};

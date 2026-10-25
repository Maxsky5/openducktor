import type {
  ClientFeedback,
  ClientFeedbackKind,
} from "@openducktor/frontend-core/platform/client-feedback";
import type { DeviceKeyValueStore } from "../device-data/device-store";

export const createMemoryDeviceStore = (
  initial?: Record<string, string>,
): DeviceKeyValueStore & { values: Map<string, string> } => {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    values,
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => values.delete(key),
    getAllKeys: () => [...values.keys()],
  };
};

/** Device stores of saved hosts, keyed by host ID, with a record of deleted stores. */
export const createMemoryHostStores = () => {
  const stores = new Map<string, ReturnType<typeof createMemoryDeviceStore>>();
  const deleted: string[] = [];
  return {
    stores,
    deleted,
    open(hostId: string) {
      let store = stores.get(hostId);
      if (!store) {
        store = createMemoryDeviceStore();
        stores.set(hostId, store);
      }
      return store;
    },
    remove(hostId: string) {
      stores.delete(hostId);
      deleted.push(hostId);
    },
  };
};

export const createRecordingFeedback = (): ClientFeedback & {
  messages: { kind: ClientFeedbackKind; message: string }[];
} => {
  const messages: { kind: ClientFeedbackKind; message: string }[] = [];
  return {
    messages,
    show: (kind, message) => {
      messages.push({ kind, message });
    },
    dismiss: () => {},
  };
};

import { createStore } from "zustand/vanilla";
import {
  type DevicePreferencesRecord,
  devicePreferencesRecord,
  type InvalidDeviceRecord,
  readDeviceRecord,
  writeDeviceRecord,
} from "../device-data/device-records";
import type { DeviceKeyValueStore } from "../device-data/device-store";

export type DevicePreferencesState = {
  preferences: DevicePreferencesRecord;
  invalid: InvalidDeviceRecord | null;
};

/** Device preferences: theme and Show reasoning. They never reach a host. */
export const createDevicePreferences = (store: DeviceKeyValueStore) => {
  const read = readDeviceRecord(store, devicePreferencesRecord);
  const state = createStore<DevicePreferencesState>(() => ({
    preferences: read.ok ? read.value : devicePreferencesRecord.initial,
    invalid: read.ok ? null : read.invalid,
  }));
  const update = (patch: Partial<DevicePreferencesRecord>) => {
    const next = { ...state.getState().preferences, ...patch };
    writeDeviceRecord(store, devicePreferencesRecord, next);
    state.setState({ preferences: next, invalid: null });
  };
  return {
    state,
    update,
    /** Replaces only the damaged preferences record with the defaults. */
    reset() {
      store.remove(devicePreferencesRecord.key);
      state.setState({ preferences: devicePreferencesRecord.initial, invalid: null });
    },
  };
};

export type DevicePreferences = ReturnType<typeof createDevicePreferences>;

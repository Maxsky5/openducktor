import { describe, expect, test } from "bun:test";
import { DEVICE_PREFERENCES_KEY } from "../device-data/device-records";
import { createMemoryDeviceStore } from "../test-support/memory-device-store";
import { createDevicePreferences } from "./device-preferences";

describe("device preferences", () => {
  test("starts with System theme and hidden reasoning", () => {
    const preferences = createDevicePreferences(createMemoryDeviceStore());
    expect(preferences.state.getState()).toEqual({
      preferences: { theme: "system", showReasoning: false },
      invalid: null,
    });
  });

  test("persists each change", () => {
    const store = createMemoryDeviceStore();
    createDevicePreferences(store).update({ theme: "dark" });
    expect(createDevicePreferences(store).state.getState().preferences).toEqual({
      theme: "dark",
      showReasoning: false,
    });
  });

  test("reports a damaged record and resets only that record", () => {
    const store = createMemoryDeviceStore({
      [DEVICE_PREFERENCES_KEY]: JSON.stringify({ theme: "sepia", showReasoning: true }),
      other: "kept",
    });
    const preferences = createDevicePreferences(store);
    expect(preferences.state.getState().invalid?.name).toBe("Preferences");
    preferences.reset();
    expect(store.getString(DEVICE_PREFERENCES_KEY)).toBeUndefined();
    expect(store.getString("other")).toBe("kept");
    expect(preferences.state.getState().invalid).toBeNull();
  });
});

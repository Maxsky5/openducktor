import { describe, expect, test } from "bun:test";
import {
  globalConfigSchema,
  settingsSnapshotSaveInputSchema,
  settingsSnapshotSchema,
  systemSettingsSchema,
} from "./index";

describe("system settings", () => {
  test("defaults older global configs and snapshots to an empty system section", () => {
    expect(globalConfigSchema.parse({ version: 3 }).system).toEqual({});
    expect(settingsSnapshotSchema.parse({ theme: "light" }).system).toEqual({});
  });

  test("accepts absent or supported preferences and rejects null and unknown tools", () => {
    expect(systemSettingsSchema.parse({})).toEqual({});
    expect(systemSettingsSchema.parse({ preferredOpenInToolId: "zed" })).toEqual({
      preferredOpenInToolId: "zed",
    });
    for (const preferredOpenInToolId of [null, "unknown"]) {
      expect(systemSettingsSchema.safeParse({ preferredOpenInToolId }).success).toBe(false);
    }
  });

  test("save inputs require system and preserve an explicit clear", () => {
    const snapshot = settingsSnapshotSchema.parse({ theme: "light" });
    expect(
      settingsSnapshotSaveInputSchema.parse({ ...snapshot, expectedSystem: snapshot.system })
        .system,
    ).toEqual({});
    expect(settingsSnapshotSaveInputSchema.safeParse(snapshot).success).toBe(false);
    const { system: _system, ...withoutSystem } = { ...snapshot, expectedSystem: snapshot.system };
    expect(settingsSnapshotSaveInputSchema.safeParse(withoutSystem).success).toBe(false);
  });
});

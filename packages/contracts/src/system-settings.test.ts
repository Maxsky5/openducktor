import { describe, expect, test } from "bun:test";
import {
  globalConfigSchema,
  settingsSnapshotSaveInputSchema,
  settingsSnapshotSchema,
  systemSettingsSchema,
} from "./index";

describe("system settings", () => {
  test("defaults older global configs and snapshots to an empty system section", () => {
    expect(globalConfigSchema.parse({ version: 4 }).system).toEqual({});
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

  test("save inputs omit untouched system settings and preserve an explicit clear", () => {
    expect(settingsSnapshotSaveInputSchema.parse({}).global).toBeUndefined();
    const input = { global: { system: { preferredOpenInToolId: { type: "clear" } } } };
    expect(settingsSnapshotSaveInputSchema.parse(input).global?.system).toEqual({
      preferredOpenInToolId: { type: "clear" },
    });
  });
});

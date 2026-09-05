import { describe, expect, test } from "bun:test";
import { notificationOsCapabilityQueryOptions } from "./notifications";

describe("notificationOsCapabilityQueryOptions", () => {
  test("refreshes permission after the app regains focus", () => {
    const options = notificationOsCapabilityQueryOptions(async () => ({
      permission: "denied",
      platform: "electron",
      supported: true,
      canGuaranteeSilent: true,
    }));

    expect(options.refetchOnWindowFocus).toBe(true);
  });
});

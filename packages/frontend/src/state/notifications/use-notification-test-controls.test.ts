import { describe, expect, test } from "bun:test";
import type { NotificationOsCapability } from "@openducktor/contracts";
import { describeNotificationOsCapability } from "./use-notification-test-controls";

const capability = (
  overrides: Partial<NotificationOsCapability> = {},
): NotificationOsCapability => ({
  platform: "browser",
  supported: true,
  permission: "granted",
  canGuaranteeSilent: true,
  ...overrides,
});

describe("notification OS capability description", () => {
  test("distinguishes denied permission from available delivery", () => {
    expect(describeNotificationOsCapability(capability({ permission: "denied" }), null)).toBe(
      "OS notification permission is denied.",
    );
  });

  test("shows an actionable query error", () => {
    expect(describeNotificationOsCapability(undefined, new Error("Capability check failed."))).toBe(
      "Capability check failed.",
    );
  });
});

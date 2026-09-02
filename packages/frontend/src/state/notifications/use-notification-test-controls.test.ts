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
      "OS notifications are disabled in browser settings. Allow notifications for OpenDucktor to receive alerts outside the app.",
    );
    expect(
      describeNotificationOsCapability(
        capability({ platform: "electron", permission: "denied" }),
        null,
      ),
    ).toBe(
      "OS notifications are disabled in system settings. Allow OpenDucktor notifications to receive alerts outside the app.",
    );
    expect(describeNotificationOsCapability(capability(), null)).toBe(
      "OS notifications are enabled. OpenDucktor can send alerts outside the app.",
    );
    expect(describeNotificationOsCapability(capability({ permission: "prompt" }), null)).toBe(
      "OS notifications are not enabled yet. Test OS to choose whether to allow them.",
    );
  });

  test("shows an actionable query error", () => {
    expect(describeNotificationOsCapability(undefined, new Error("Capability check failed."))).toBe(
      "Capability check failed.",
    );
  });

  test("shows the latest delivery failure instead of reporting ready", () => {
    expect(
      describeNotificationOsCapability(
        capability({ failureMessage: "The native notification service failed." }),
        null,
      ),
    ).toBe("The native notification service failed.");
  });
});

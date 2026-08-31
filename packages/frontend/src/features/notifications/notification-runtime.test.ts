import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { createNotificationRuntime } from "./notification-runtime";

const createBridge = (overrides: Partial<NotificationBridge> = {}): NotificationBridge => ({
  getCapability: async () => ({
    platform: "browser",
    supported: true,
    permission: "prompt",
    canGuaranteeSilent: true,
  }),
  requestPermission: async () => ({
    platform: "browser",
    supported: true,
    permission: "granted",
    canGuaranteeSilent: true,
  }),
  isAppFocused: async () => false,
  isExternalDeliveryOwner: () => true,
  showOsNotification: async () => ({ status: "shown" }),
  publishOccurrence: () => {},
  subscribeOccurrences: () => () => {},
  subscribeClicks: () => () => {},
  dispose: () => {},
  ...overrides,
});

describe("notification runtime tests", () => {
  test("requests permission only from the explicit OS test", async () => {
    const requestPermission = mock(async () => ({
      platform: "browser" as const,
      supported: true,
      permission: "granted" as const,
      canGuaranteeSilent: true,
    }));
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({ requestPermission, showOsNotification }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });
    const settings = createDefaultNotificationSettings();
    settings.volumePercent = 0;

    await runtime.getCapability();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(showOsNotification).not.toHaveBeenCalled();
    await runtime.testOs(settings);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(showOsNotification.mock.calls[0]?.[0].silent).toBe(true);
  });

  test("does not attempt OS delivery when permission is denied", async () => {
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        requestPermission: async () => ({
          platform: "browser",
          supported: true,
          permission: "denied",
          canGuaranteeSilent: true,
        }),
        showOsNotification,
      }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });

    const result = await runtime.testOs(createDefaultNotificationSettings());
    expect(result.status).toBe("denied");
    expect(showOsNotification).not.toHaveBeenCalled();
  });
});

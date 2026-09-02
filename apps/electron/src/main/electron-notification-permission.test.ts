import { describe, expect, test } from "bun:test";
import {
  mapMacosNotificationPermission,
  resolveElectronNotificationPermission,
  resolveElectronNotificationSettingsUrl,
} from "./electron-notification-permission";

describe("Electron notification permission", () => {
  test("maps macOS authorization states to the shared permission contract", () => {
    expect(mapMacosNotificationPermission("not determined")).toBe("prompt");
    expect(mapMacosNotificationPermission("authorized")).toBe("granted");
    expect(mapMacosNotificationPermission("provisional")).toBe("granted");
    expect(mapMacosNotificationPermission("denied")).toBe("denied");
    expect(mapMacosNotificationPermission("restricted")).toBe("denied");
  });

  test("queries macOS and does not claim permission state on other platforms", () => {
    let readCount = 0;
    const readMacosAuthorizationStatus = () => {
      readCount += 1;
      return "denied" as const;
    };

    expect(resolveElectronNotificationPermission("darwin", readMacosAuthorizationStatus)).toBe(
      "denied",
    );
    expect(resolveElectronNotificationPermission("win32", readMacosAuthorizationStatus)).toBe(
      "not_applicable",
    );
    expect(resolveElectronNotificationPermission("linux", readMacosAuthorizationStatus)).toBe(
      "not_applicable",
    );
    expect(readCount).toBe(1);
  });

  test("opens the native notification settings page where the OS has one", () => {
    expect(resolveElectronNotificationSettingsUrl("darwin")).toBe(
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    );
    expect(resolveElectronNotificationSettingsUrl("win32")).toBe("ms-settings:notifications");
    expect(resolveElectronNotificationSettingsUrl("linux")).toBeNull();
  });
});

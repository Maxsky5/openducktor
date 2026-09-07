import { createRequire } from "node:module";
import type { NotificationOsCapability } from "@openducktor/contracts";
import { ElectronOperationError, errorMessage } from "../effect/electron-errors";

type MacosNotificationAuthorizationStatus =
  | "not determined"
  | "denied"
  | "authorized"
  | "provisional"
  | "restricted";

type MacosPermissions = {
  getAuthStatus(type: "notifications"): MacosNotificationAuthorizationStatus;
};

const nodeRequire = createRequire(import.meta.url);

export const mapMacosNotificationPermission = (
  status: MacosNotificationAuthorizationStatus,
): NotificationOsCapability["permission"] => {
  if (status === "not determined") return "prompt";
  if (status === "authorized" || status === "provisional") return "granted";
  return "denied";
};

export const readMacosNotificationAuthorizationStatus =
  (): MacosNotificationAuthorizationStatus => {
    try {
      const permissions: MacosPermissions = nodeRequire("node-mac-permissions");
      return permissions.getAuthStatus("notifications");
    } catch (cause) {
      throw new ElectronOperationError({
        operation: "electron.notifications.read-macos-permission",
        message: `Electron could not read macOS notification permission: ${errorMessage(cause)}`,
        cause,
      });
    }
  };

export const resolveElectronNotificationPermission = (
  platform: NodeJS.Platform,
  readMacosAuthorizationStatus: () => MacosNotificationAuthorizationStatus,
): NotificationOsCapability["permission"] => {
  if (platform !== "darwin") return "not_applicable";
  return mapMacosNotificationPermission(readMacosAuthorizationStatus());
};

export const resolveElectronNotificationSettingsUrl = (
  platform: NodeJS.Platform,
): string | null => {
  if (platform === "darwin") {
    return "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
  }
  if (platform === "win32") return "ms-settings:notifications";
  return null;
};

import { describe, expect, mock, test } from "bun:test";
import type {
  NotificationDeliveryResult,
  NotificationOsCapability,
  NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import type { IpcMainInvokeEvent } from "electron";
import {
  ELECTRON_NOTIFICATION_GET_APP_FOCUS_CHANNEL,
  ELECTRON_NOTIFICATION_GET_CAPABILITY_CHANNEL,
  ELECTRON_NOTIFICATION_OPEN_SETTINGS_CHANNEL,
  ELECTRON_NOTIFICATION_REQUEST_PERMISSION_CHANNEL,
  ELECTRON_NOTIFICATION_SHOW_CHANNEL,
} from "../shared/electron-bridge-contract";
import { createElectronNotificationRuntime } from "./electron-notification-runtime";

type HandlerResult = NotificationDeliveryResult | NotificationOsCapability | boolean | void;
type Handler = (
  event: IpcMainInvokeEvent,
  request?: NotificationOsDeliveryRequest,
) => HandlerResult | Promise<HandlerResult>;

describe("Electron notification runtime", () => {
  test("registers notification IPC and opens native settings", async () => {
    const handlers = new Map<string, Handler>();
    const openExternal = mock(async () => {});
    const runtime = createElectronNotificationRuntime({
      Notification: class {
        static isSupported = () => true;
        on() {}
        show() {}
        close() {}
      },
      getPermission: () => "granted",
      getWindows: () => [],
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      openExternal,
      platform: "darwin",
    });

    expect([...handlers.keys()]).toEqual([
      ELECTRON_NOTIFICATION_GET_CAPABILITY_CHANNEL,
      ELECTRON_NOTIFICATION_REQUEST_PERMISSION_CHANNEL,
      ELECTRON_NOTIFICATION_OPEN_SETTINGS_CHANNEL,
      ELECTRON_NOTIFICATION_GET_APP_FOCUS_CHANNEL,
      ELECTRON_NOTIFICATION_SHOW_CHANNEL,
    ]);

    // SAFETY: The settings handler does not read the Electron event.
    await handlers.get(ELECTRON_NOTIFICATION_OPEN_SETTINGS_CHANNEL)?.({} as IpcMainInvokeEvent);
    expect(openExternal).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    );

    runtime.dispose();
  });
});

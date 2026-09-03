import type {
  NotificationDeliveryResult,
  NotificationOsCapability,
  NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import type { IpcMainInvokeEvent } from "electron";
import { ElectronOperationError, errorMessage } from "../effect/electron-errors";
import {
  ELECTRON_NOTIFICATION_GET_APP_FOCUS_CHANNEL,
  ELECTRON_NOTIFICATION_GET_CAPABILITY_CHANNEL,
  ELECTRON_NOTIFICATION_OPEN_SETTINGS_CHANNEL,
  ELECTRON_NOTIFICATION_REQUEST_PERMISSION_CHANNEL,
  ELECTRON_NOTIFICATION_SHOW_CHANNEL,
} from "../shared/electron-bridge-contract";
import { createElectronNotificationService } from "./electron-notification-service";
import { resolveElectronNotificationSettingsUrl } from "./electron-notification-permission";

type NotificationServiceInput = Parameters<typeof createElectronNotificationService>[0];
type ElectronNotificationIpcResult =
  | NotificationDeliveryResult
  | NotificationOsCapability
  | boolean
  | void;

type ElectronNotificationIpcMain = {
  handle(
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      request?: NotificationOsDeliveryRequest,
    ) => ElectronNotificationIpcResult | Promise<ElectronNotificationIpcResult>,
  ): void;
};

type CreateElectronNotificationRuntimeInput = NotificationServiceInput & {
  ipcMain: ElectronNotificationIpcMain;
  openExternal(url: string): Promise<void>;
  platform: NodeJS.Platform;
};

export const createElectronNotificationRuntime = ({
  ipcMain,
  openExternal,
  platform,
  ...serviceInput
}: CreateElectronNotificationRuntimeInput) => {
  const service = createElectronNotificationService(serviceInput);

  ipcMain.handle(ELECTRON_NOTIFICATION_GET_CAPABILITY_CHANNEL, () => service.getCapability());
  ipcMain.handle(ELECTRON_NOTIFICATION_REQUEST_PERMISSION_CHANNEL, () => service.getCapability());
  ipcMain.handle(ELECTRON_NOTIFICATION_OPEN_SETTINGS_CHANNEL, async () => {
    const settingsUrl = resolveElectronNotificationSettingsUrl(platform);
    if (!settingsUrl) {
      throw new ElectronOperationError({
        operation: "electron.notifications.open-system-settings",
        message: "This platform does not provide notification settings that OpenDucktor can open.",
      });
    }
    try {
      await openExternal(settingsUrl);
    } catch (cause) {
      throw new ElectronOperationError({
        operation: "electron.notifications.open-system-settings",
        message: errorMessage(cause),
        cause,
        details: { url: settingsUrl },
      });
    }
  });
  ipcMain.handle(ELECTRON_NOTIFICATION_GET_APP_FOCUS_CHANNEL, () => service.isAppFocused());
  ipcMain.handle(ELECTRON_NOTIFICATION_SHOW_CHANNEL, (_event, request) => service.show(request!));

  return { dispose: () => service.dispose() };
};

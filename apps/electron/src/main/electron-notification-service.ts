import {
  notificationClickEventSchema,
  notificationOsDeliveryRequestSchema,
  type NotificationDeliveryResult,
  type NotificationOsCapability,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import { ELECTRON_NOTIFICATION_CLICKED_CHANNEL } from "../shared/electron-bridge-contract";

type ElectronNotificationInstance = {
  onShow(listener: () => void): void;
  onFailed(listener: (error: string) => void): void;
  onClick(listener: () => void): void;
  onClose(listener: () => void): void;
  show(): void;
  close(): void;
};

type ElectronNotificationPort = {
  isSupported(): boolean;
  create(options: { title: string; body: string; silent: boolean }): ElectronNotificationInstance;
};

type ElectronNotificationWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, event: ReturnType<typeof notificationClickEventSchema.parse>): void;
  };
};

type CreateElectronNotificationServiceOptions = {
  notifications: ElectronNotificationPort;
  getWindows(): ElectronNotificationWindow[];
};

export const createElectronNotificationService = ({
  notifications,
  getWindows,
}: CreateElectronNotificationServiceOptions) => {
  const retainedNotifications = new Set<ElectronNotificationInstance>();
  let latestFailureMessage: string | undefined;

  const getCapability = (): NotificationOsCapability => {
    const capability: NotificationOsCapability = {
      platform: "electron",
      supported: notifications.isSupported(),
      permission: "not_applicable",
      canGuaranteeSilent: true,
    };
    if (latestFailureMessage) {
      capability.failureMessage = latestFailureMessage;
    }
    return capability;
  };

  const focusAndRoute = (request: NotificationOsDeliveryRequest): void => {
    const window = getWindows().find(
      (candidate) => !candidate.isDestroyed() && !candidate.webContents.isDestroyed(),
    );
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    if (!window.isVisible()) {
      window.show();
    }
    window.focus();
    window.webContents.send(
      ELECTRON_NOTIFICATION_CLICKED_CHANNEL,
      notificationClickEventSchema.parse({ navigationTarget: request.navigationTarget }),
    );
  };

  const show = async (
    rawRequest: NotificationOsDeliveryRequest,
  ): Promise<NotificationDeliveryResult> => {
    const request = notificationOsDeliveryRequestSchema.parse(rawRequest);
    if (!notifications.isSupported()) {
      return {
        status: "unsupported",
        message: "This system does not support Electron OS notifications.",
      };
    }

    return await new Promise<NotificationDeliveryResult>((resolve) => {
      let settled = false;
      const settle = (result: NotificationDeliveryResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (result.status === "shown") {
          latestFailureMessage = undefined;
        } else if (result.status === "failed") {
          latestFailureMessage = result.message;
        }
        resolve(result);
      };

      try {
        const notification = notifications.create({
          title: request.title,
          body: request.body,
          silent: true,
        });
        retainedNotifications.add(notification);
        notification.onShow(() => settle({ status: "shown" }));
        notification.onFailed((error) => {
          retainedNotifications.delete(notification);
          settle({ status: "failed", message: error.slice(0, 500) });
        });
        notification.onClick(() => focusAndRoute(request));
        notification.onClose(() => retainedNotifications.delete(notification));
        notification.show();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        settle({ status: "failed", message: message.slice(0, 500) });
      }
    });
  };

  return {
    getCapability,
    isAppFocused: () => getWindows().some((window) => !window.isDestroyed() && window.isFocused()),
    show,
    dispose(): void {
      for (const notification of retainedNotifications) {
        notification.close();
      }
      retainedNotifications.clear();
    },
  };
};

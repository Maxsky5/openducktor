import {
  notificationClickEventSchema,
  notificationOsDeliveryRequestSchema,
  type NotificationDeliveryResult,
  type NotificationOsCapability,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import type { Event as ElectronEvent } from "electron";
import { ELECTRON_NOTIFICATION_CLICKED_CHANNEL } from "../shared/electron-bridge-contract";

type ElectronNotificationInstance = {
  on(event: "show" | "click" | "close", listener: () => void): void;
  on(event: "failed", listener: (event: ElectronEvent, error: string) => void): void;
  show(): void;
  close(): void;
};

type ElectronNotificationConstructor = {
  new (options: { title: string; body: string; silent: boolean }): ElectronNotificationInstance;
  isSupported(): boolean;
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
  Notification: ElectronNotificationConstructor;
  getWindows(): ElectronNotificationWindow[];
};

export const createElectronNotificationService = ({
  Notification,
  getWindows,
}: CreateElectronNotificationServiceOptions) => {
  const retainedNotifications = new Set<ElectronNotificationInstance>();
  let latestFailureMessage: string | undefined;

  const getCapability = (): NotificationOsCapability => {
    const capability: NotificationOsCapability = {
      platform: "electron",
      supported: Notification.isSupported(),
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
    if (!Notification.isSupported()) {
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
        const notification = new Notification({
          title: request.title,
          body: request.body,
          silent: true,
        });
        retainedNotifications.add(notification);
        notification.on("show", () => settle({ status: "shown" }));
        notification.on("failed", (_event, error) => {
          retainedNotifications.delete(notification);
          settle({ status: "failed", message: error.slice(0, 500) });
        });
        notification.on("click", () => focusAndRoute(request));
        notification.on("close", () => retainedNotifications.delete(notification));
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

import {
  notificationClickEventSchema,
  notificationOsDeliveryRequestSchema,
  type NotificationDeliveryResult,
  type NotificationOsCapability,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import type { Event as ElectronEvent } from "electron";
import { ELECTRON_NOTIFICATION_CLICKED_CHANNEL } from "../shared/electron-bridge-contract";

// Limit the wait for show confirmation because Linux does not emit failed.
const NOTIFICATION_SHOW_TIMEOUT_MS = 10_000;

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
  getPermission(): NotificationOsCapability["permission"];
  getWindows(): ElectronNotificationWindow[];
};

export const createElectronNotificationService = ({
  Notification,
  getPermission,
  getWindows,
}: CreateElectronNotificationServiceOptions) => {
  const retainedNotifications = new Map<ElectronNotificationInstance, () => void>();
  let latestFailureMessage: string | undefined;

  const getCapability = (): NotificationOsCapability => {
    const capability: NotificationOsCapability = {
      platform: "electron",
      supported: Notification.isSupported(),
      permission: getPermission(),
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
      let notification: ElectronNotificationInstance | undefined;
      let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: NotificationDeliveryResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(confirmationTimer);
        if (result.status === "shown") {
          latestFailureMessage = undefined;
        } else if (result.status === "failed") {
          latestFailureMessage = result.message;
        }
        resolve(result);
      };

      try {
        const native = new Notification({
          title: request.title,
          body: request.body,
          silent: true,
        });
        notification = native;
        retainedNotifications.set(native, () =>
          settle({
            status: "failed",
            message: "Notification delivery stopped before the system confirmed it was shown.",
          }),
        );
        native.on("show", () => settle({ status: "shown" }));
        native.on("failed", (_event, error) => {
          retainedNotifications.delete(native);
          settle({ status: "failed", message: error.slice(0, 500) });
        });
        native.on("click", () => focusAndRoute(request));
        native.on("close", () => {
          retainedNotifications.delete(native);
          settle({
            status: "failed",
            message:
              "The system closed the notification before confirming delivery. Check system notification settings and test again.",
          });
        });
        confirmationTimer = setTimeout(() => {
          settle({
            status: "failed",
            message:
              "The system did not confirm notification delivery within 10 seconds. Check system notification settings and test again.",
          });
          retainedNotifications.delete(native);
          native.close();
        }, NOTIFICATION_SHOW_TIMEOUT_MS);
        native.show();
      } catch (cause) {
        if (notification) retainedNotifications.delete(notification);
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
      for (const [notification, settle] of retainedNotifications) {
        settle();
        notification.close();
      }
      retainedNotifications.clear();
    },
  };
};

import {
  notificationOsDeliveryRequestSchema,
  type NotificationClickEvent,
  type NotificationDeliveryResult,
  type NotificationNavigationTarget,
  type NotificationOsCapability,
} from "@openducktor/contracts";
import type { NotificationBridge } from "@openducktor/frontend";
import {
  createBrowserNotificationCoordinator,
  type BrowserNotificationCoordinator,
} from "./browser-notification-coordinator";

export type BrowserNotificationInstance = {
  onclick: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onshow: ((event: Event) => void) | null;
  close(): void;
};

export type BrowserNotificationConstructor = {
  readonly permission: NotificationPermission;
  readonly prototype: { silent?: boolean | null };
  requestPermission(): Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): BrowserNotificationInstance;
};

type CreateBrowserNotificationBridgeOptions = {
  NativeNotification?: BrowserNotificationConstructor | null;
  coordinator?: BrowserNotificationCoordinator;
  canGuaranteeSilent?: boolean;
  focusWindow?: () => void;
};

const resolvePermission = (
  permission: NotificationPermission,
): NotificationOsCapability["permission"] => {
  if (permission === "default") {
    return "prompt";
  }
  return permission;
};

const detectSilentSupport = (NativeNotification: BrowserNotificationConstructor | null): boolean =>
  Boolean(NativeNotification && "silent" in NativeNotification.prototype);

export const createBrowserNotificationBridge = ({
  NativeNotification = globalThis.Notification ?? null,
  coordinator = createBrowserNotificationCoordinator(),
  canGuaranteeSilent = detectSilentSupport(NativeNotification),
  focusWindow = () => window.focus(),
}: CreateBrowserNotificationBridgeOptions = {}): NotificationBridge => {
  const clickListeners = new Set<(event: NotificationClickEvent) => void>();
  const retainedNotifications = new Set<BrowserNotificationInstance>();
  let latestFailureMessage: string | undefined;

  const getCapability = async (): Promise<NotificationOsCapability> => {
    if (!NativeNotification) {
      return {
        platform: "browser",
        supported: false,
        permission: "not_applicable",
        canGuaranteeSilent: false,
        failureMessage: "This browser does not support OS notifications.",
      };
    }
    if (!coordinator.supported) {
      return {
        platform: "browser",
        supported: false,
        permission: resolvePermission(NativeNotification.permission),
        canGuaranteeSilent,
        failureMessage: "This browser cannot coordinate notifications and sound across tabs.",
      };
    }
    const coordinationFailure = coordinator.getFailureMessage();
    if (coordinationFailure) {
      return {
        platform: "browser",
        supported: false,
        permission: resolvePermission(NativeNotification.permission),
        canGuaranteeSilent,
        failureMessage: `Browser notification coordination failed: ${coordinationFailure}`,
      };
    }
    const capability: NotificationOsCapability = {
      platform: "browser",
      supported: true,
      permission: resolvePermission(NativeNotification.permission),
      canGuaranteeSilent,
    };
    if (latestFailureMessage) {
      capability.failureMessage = latestFailureMessage;
    }
    return capability;
  };

  const publishClick = (navigationTarget: NotificationNavigationTarget): void => {
    focusWindow();
    const event = { navigationTarget };
    for (const listener of clickListeners) {
      listener(event);
    }
  };

  const showOsNotification = async (
    rawRequest: Parameters<NotificationBridge["showOsNotification"]>[0],
  ): Promise<NotificationDeliveryResult> => {
    const request = notificationOsDeliveryRequestSchema.parse(rawRequest);
    const capability = await getCapability();
    if (!capability.supported) {
      return {
        status: "unsupported",
        message: capability.failureMessage ?? "Browser OS notifications are unavailable.",
      };
    }
    if (capability.permission !== "granted") {
      const message =
        capability.permission === "denied"
          ? "Browser notification permission is denied. Enable it in browser settings."
          : "Browser notification permission is needed. Use Test OS in Notifications settings.";
      return { status: "denied", message };
    }
    const SupportedNotification = NativeNotification;
    if (!SupportedNotification) {
      return {
        status: "unsupported",
        message: "This browser does not support OS notifications.",
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
        const notification = new SupportedNotification(request.title, {
          body: request.body,
          data: request.navigationTarget,
          silent: true,
        });
        retainedNotifications.add(notification);
        notification.onshow = () => settle({ status: "shown" });
        notification.onerror = () => {
          retainedNotifications.delete(notification);
          settle({ status: "failed", message: "The browser failed to show the OS notification." });
        };
        notification.onclick = () => publishClick(request.navigationTarget);
        notification.onclose = () => retainedNotifications.delete(notification);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        settle({ status: "failed", message: message.slice(0, 500) });
      }
    });
  };

  return {
    getCapability,
    async requestPermission() {
      if (!NativeNotification || !coordinator.supported) {
        return getCapability();
      }
      try {
        await NativeNotification.requestPermission();
        latestFailureMessage = undefined;
      } catch (cause) {
        latestFailureMessage = cause instanceof Error ? cause.message : String(cause);
      }
      return getCapability();
    },
    isAppFocused: () => coordinator.isAnyTabFocused(),
    async withExternalDeliveryOwnership(occurrenceId, dispatch) {
      const owner = coordinator.isExternalDeliveryOwner();
      try {
        await dispatch(owner);
      } finally {
        if (owner) {
          coordinator.completeExternalDelivery(occurrenceId);
        }
      }
    },
    showOsNotification,
    publishOccurrence: (occurrence) => coordinator.publishOccurrence(occurrence),
    subscribeOccurrences: (listener) => coordinator.subscribeOccurrences(listener),
    subscribeClicks(listener) {
      clickListeners.add(listener);
      return () => clickListeners.delete(listener);
    },
    dispose() {
      retainedNotifications.clear();
      clickListeners.clear();
      coordinator.dispose();
    },
  };
};

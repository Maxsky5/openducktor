import type { NotificationOsCapability, NotificationSettings } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { notificationOsCapabilityQueryOptions } from "@/state/queries/notifications";
import { useNotificationContext } from "./notification-context";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const describeNotificationOsCapability = (
  capability: NotificationOsCapability | undefined,
  error: Error | null,
): string => {
  if (error) return error.message;
  if (!capability) return "Checking OS notification support…";
  if (!capability.supported) {
    return capability.failureMessage ?? "OS notifications are unavailable.";
  }
  if (capability.permission === "denied") {
    if (capability.platform === "browser") {
      return "OS notifications are disabled in browser settings. Allow notifications for OpenDucktor to receive alerts outside the app.";
    }
    return "OS notifications are disabled in system settings. Allow OpenDucktor notifications to receive alerts outside the app.";
  }
  if (capability.permission === "prompt") {
    return "OS notifications are not enabled yet. Test OS to choose whether to allow them.";
  }
  if (capability.failureMessage) return capability.failureMessage;
  if (capability.permission === "granted") {
    return "OS notifications are enabled. OpenDucktor can send alerts outside the app.";
  }
  return "OS notifications are available. This platform does not report per-app permission.";
};

export const useNotificationTestControls = (settings: NotificationSettings | null) => {
  const runtime = useNotificationContext();
  const capabilityQuery = useQuery(notificationOsCapabilityQueryOptions(runtime.getCapability));
  const [status, setStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);

  const testNotification = async (target: "in_app" | "os"): Promise<void> => {
    if (!settings) {
      setStatus("Notification settings are unavailable. Go back and retry setup.");
      return;
    }

    setIsTesting(true);
    setStatus(null);
    try {
      if (target === "in_app") {
        await runtime.testInApp(settings);
        setStatus("In-app test sent.");
        return;
      }

      const result = await runtime.testOs(settings);
      await capabilityQuery.refetch();
      setStatus(result.status === "shown" ? "OS test sent." : result.message);
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setIsTesting(false);
    }
  };

  const openSystemSettings = async (): Promise<void> => {
    setIsOpeningSettings(true);
    setStatus(null);
    try {
      await runtime.openSystemSettings();
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setIsOpeningSettings(false);
    }
  };

  return {
    capability: capabilityQuery.data,
    capabilityDescription: describeNotificationOsCapability(
      capabilityQuery.data,
      capabilityQuery.error,
    ),
    isTesting,
    isOpeningSettings,
    openSystemSettings,
    status,
    testNotification,
  };
};

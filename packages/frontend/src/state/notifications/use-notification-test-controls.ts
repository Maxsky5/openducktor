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
  if (capability.permission === "denied") return "OS notification permission is denied.";
  if (capability.permission === "prompt") {
    return "Permission will be requested only when you test OS notifications.";
  }
  return "OS notifications are ready.";
};

export const useNotificationTestControls = (settings: NotificationSettings | null) => {
  const runtime = useNotificationContext();
  const capabilityQuery = useQuery(notificationOsCapabilityQueryOptions(runtime.getCapability));
  const [status, setStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

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

  return {
    capability: capabilityQuery.data,
    capabilityDescription: describeNotificationOsCapability(
      capabilityQuery.data,
      capabilityQuery.error,
    ),
    isTesting,
    status,
    testNotification,
  };
};

import { type ReactElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { NotificationDispatchFailure } from "./notification-policy";

export function NotificationFailurePrompt({
  failure,
  onOpenSettings,
  onReload,
}: {
  failure: NotificationDispatchFailure | null;
  onOpenSettings(): void;
  onReload(): void;
}): ReactElement | null {
  const reportedOccurrenceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!failure) {
      reportedOccurrenceIdRef.current = null;
      return;
    }
    if (reportedOccurrenceIdRef.current === failure.occurrenceId) return;
    reportedOccurrenceIdRef.current = failure.occurrenceId;
    let title = "OS notification failed";
    let id = "notification-os-delivery-failure";
    let action = { label: "Open settings", onClick: onOpenSettings };
    if (failure.channel === "coordination") {
      title = "Browser notification coordination failed";
      id = "notification-coordination-failure";
      action = { label: "Reload", onClick: onReload };
    }
    toast.error(title, {
      id,
      description: failure.message,
      action,
    });
  }, [failure, onOpenSettings, onReload]);

  return null;
}
